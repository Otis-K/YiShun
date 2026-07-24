package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/models"
	"github.com/flowcanvas/flowcanvas-backend-sdk/providers/tmlabtasks"
	"github.com/flowcanvas/flowcanvas-backend-sdk/storage/aliyunoss"
	"github.com/flowcanvas/flowcanvas-backend-sdk/taskqueue"
)

type request struct {
	Action              string                   `json:"action"`
	Prompt              string                   `json:"prompt"`
	Model               string                   `json:"model"`
	Size                string                   `json:"size"`
	AspectRatio         string                   `json:"aspectRatio"`
	Images              []string                 `json:"images"`
	ImageReferenceOrder []imageReferencePosition `json:"imageReferenceOrder"`
	Parameters          map[string]any           `json:"parameters"`
	OutputDir           string                   `json:"outputDir"`
	ModeType            string                   `json:"modeType"`
	Ratio               string                   `json:"ratio"`
	Resolution          string                   `json:"resolution"`
	Duration            int                      `json:"duration"`
	EnableSound         string                   `json:"enableSound"`
	ImageURLs           []string                 `json:"imageUrls"`
	AudioURLs           []string                 `json:"audioUrls"`
	MixedList           []models.MixedMedia      `json:"mixedList"`
	FirstImage          string                   `json:"firstImage"`
	LastImage           string                   `json:"lastImage"`
	ReferenceImages     []string                 `json:"referenceImages"`
	ReferenceVideos     []string                 `json:"referenceVideos"`
	ReferenceAudios     []string                 `json:"referenceAudios"`
	LocalAssets         []aliyunoss.LocalAsset   `json:"localAssets"`
}

type imageReferencePosition struct {
	Source string `json:"source"`
	Index  int    `json:"index"`
}

type response struct {
	OK    bool           `json:"ok"`
	Data  map[string]any `json:"data,omitempty"`
	Error string         `json:"error,omitempty"`
}

type progressResponse struct {
	Type     string  `json:"type"`
	Status   string  `json:"status"`
	Progress float64 `json:"progress"`
	Message  string  `json:"message"`
}

const maxImageReferences = 14

func main() {
	if err := run(); err != nil {
		_ = json.NewEncoder(os.Stdout).Encode(response{OK: false, Error: err.Error()})
		return
	}
}

func run() error {
	data, err := io.ReadAll(io.LimitReader(os.Stdin, 2<<20))
	if err != nil {
		return err
	}
	var input request
	if err := json.Unmarshal(data, &input); err != nil {
		return fmt.Errorf("decode request: %w", err)
	}
	if input.Action != "image.generate" && input.Action != "video.generate" {
		return fmt.Errorf("unsupported action: %s", input.Action)
	}
	if input.Action == "image.generate" && len(input.Images)+len(input.LocalAssets) > maxImageReferences {
		return fmt.Errorf("nano banana pro accepts at most %d reference images", maxImageReferences)
	}
	apiKey := strings.TrimSpace(os.Getenv("FLOWCANVAS_MODEL_API_KEY"))
	baseURL := strings.TrimSpace(os.Getenv("FLOWCANVAS_MODEL_BASE_URL"))
	if baseURL == "" {
		baseURL = tmlabtasks.DefaultBaseURL
	}
	client, err := tmlabtasks.New(tmlabtasks.Config{BaseURL: baseURL, APIKey: apiKey, PollInterval: 5 * time.Second})
	if err != nil {
		return err
	}
	registry := models.NewRegistry()
	if err := registry.Register(models.Model{ID: tmlabtasks.NanoBananaProSpecial1, Provider: "tmlab-tasks", Image: client}); err != nil {
		return err
	}
	for _, modelID := range []string{tmlabtasks.Seedance20Mini, tmlabtasks.Seedance20Fast, tmlabtasks.Seedance20Pro, tmlabtasks.Seedance20Pro431} {
		if err := registry.Register(models.Model{ID: modelID, Provider: "tmlab-tasks", Video: client}); err != nil {
			return err
		}
	}
	service, err := models.NewService(registry)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	progressEncoder := json.NewEncoder(os.Stderr)
	emitProgress := func(value models.Progress) {
		_ = progressEncoder.Encode(progressResponse{Type: "progress", Status: value.Status, Progress: value.Progress, Message: value.Message})
	}
	uploadedAssets, err := resolveLocalAssets(ctx, &input)
	if err != nil {
		return err
	}
	queue, err := taskqueue.New(1, 16)
	if err != nil {
		return err
	}
	defer queue.Close()
	future, err := queue.Submit(ctx, func(jobContext context.Context) (any, error) {
		if input.Action == "image.generate" {
			return service.GenerateImage(jobContext, models.ImageRequest{Model: input.Model, Prompt: input.Prompt, Size: input.Size, Images: input.Images, AspectRatio: input.AspectRatio, Parameters: input.Parameters}, emitProgress)
		}
		return service.GenerateVideo(jobContext, models.VideoRequest{
			Model: input.Model, Prompt: input.Prompt, ModeType: input.ModeType, Ratio: input.Ratio,
			Resolution: input.Resolution, Duration: input.Duration, EnableSound: input.EnableSound,
			ImageURLs: input.ImageURLs, AudioURLs: input.AudioURLs, MixedList: input.MixedList, Parameters: input.Parameters,
			FirstImage: input.FirstImage, LastImage: input.LastImage, ReferenceImages: input.ReferenceImages,
			ReferenceVideos: input.ReferenceVideos, ReferenceAudios: input.ReferenceAudios,
		}, emitProgress)
	})
	if err != nil {
		return err
	}
	queued := <-future
	if queued.Err != nil {
		return queued.Err
	}
	if input.Action == "image.generate" {
		result := queued.Value.(*models.ImageResult)
		localPath, err := saveImageResult(input.OutputDir, result)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(response{OK: true, Data: map[string]any{
			"provider": result.Provider, "model": result.Model, "taskId": result.TaskID, "status": result.Status,
			"progress": result.Progress, "url": result.URL, "contentType": result.ContentType,
			"bytes": len(result.Content), "localPath": localPath, "request": map[string]any{
				"size": input.Size, "aspectRatio": input.AspectRatio, "referenceCount": len(input.Images), "uploadedAssets": uploadedAssets,
			},
		}})
	}
	result := queued.Value.(*models.VideoResult)
	localPath, err := saveVideoResult(input.OutputDir, result)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(response{OK: true, Data: map[string]any{
		"provider": result.Provider, "model": result.Model, "taskId": result.TaskID, "status": result.Status,
		"progress": result.Progress, "url": result.URL, "remoteUrl": result.RemoteURL, "contentType": result.ContentType,
		"bytes": len(result.Content), "localPath": localPath,
		"request": map[string]any{"modeType": input.ModeType, "ratio": input.Ratio, "resolution": input.Resolution, "duration": input.Duration, "enableSound": input.EnableSound, "firstImage": input.FirstImage, "lastImage": input.LastImage, "referenceImages": input.ReferenceImages, "referenceVideos": input.ReferenceVideos, "referenceAudios": input.ReferenceAudios, "uploadedAssets": uploadedAssets},
	}})
}

func resolveLocalAssets(ctx context.Context, input *request) ([]map[string]any, error) {
	if input == nil || len(input.LocalAssets) == 0 {
		return nil, nil
	}
	if input.Action == "image.generate" {
		for _, local := range input.LocalAssets {
			if strings.ToLower(strings.TrimSpace(local.Kind)) != "image" {
				return nil, errors.New("image generation local references must be images")
			}
		}
	}
	ossConfig, err := aliyunoss.LoadConfig()
	if err != nil {
		return nil, fmt.Errorf("configure local reference upload: %w", err)
	}
	uploader, err := aliyunoss.New(ossConfig)
	if err != nil {
		return nil, fmt.Errorf("configure local reference upload: %w", err)
	}
	metadata := make([]map[string]any, 0, len(input.LocalAssets))
	localImageURLs := make([]string, 0, len(input.LocalAssets))
	for _, local := range input.LocalAssets {
		uploaded, err := uploader.Upload(ctx, local)
		if err != nil {
			return nil, fmt.Errorf("upload %s reference %q: %w", local.Kind, local.Name, err)
		}
		if input.Action == "image.generate" {
			localImageURLs = append(localImageURLs, uploaded.URL)
		} else if input.Model == tmlabtasks.Seedance20Pro431 {
			switch uploaded.Role {
			case "firstFrame":
				if uploaded.Kind != "image" {
					return nil, errors.New("first frame must be an image")
				}
				input.FirstImage = uploaded.URL
			case "lastFrame":
				if uploaded.Kind != "image" {
					return nil, errors.New("last frame must be an image")
				}
				input.LastImage = uploaded.URL
			default:
				switch uploaded.Kind {
				case "image":
					input.ReferenceImages = append(input.ReferenceImages, uploaded.URL)
				case "video":
					input.ReferenceVideos = append(input.ReferenceVideos, uploaded.URL)
				case "audio":
					input.ReferenceAudios = append(input.ReferenceAudios, uploaded.URL)
				default:
					return nil, fmt.Errorf("unsupported Pro(431) reference kind %q", uploaded.Kind)
				}
			}
		} else {
			switch input.ModeType {
			case "image2video":
				switch uploaded.Kind {
				case "image":
					input.ImageURLs = append(input.ImageURLs, uploaded.URL)
				case "audio":
					input.AudioURLs = append(input.AudioURLs, uploaded.URL)
				default:
					return nil, errors.New("image2video does not accept reference videos; use mixed2video")
				}
			case "mixed2video":
				input.MixedList = append(input.MixedList, models.MixedMedia{URL: uploaded.URL, Type: uploaded.Kind})
			default:
				return nil, errors.New("text2video does not accept local reference assets")
			}
		}
		metadata = append(metadata, map[string]any{"kind": uploaded.Kind, "role": uploaded.Role, "mimeType": uploaded.MimeType, "size": uploaded.Size})
	}
	if input.Action == "image.generate" {
		merged, err := mergeImageReferences(input.Images, localImageURLs, input.ImageReferenceOrder)
		if err != nil {
			return nil, err
		}
		input.Images = merged
		if len(input.Images) > maxImageReferences {
			return nil, fmt.Errorf("nano banana pro accepts at most %d reference images", maxImageReferences)
		}
	}
	input.LocalAssets = nil
	if input.Action == "video.generate" && input.Model == tmlabtasks.Seedance20Pro431 && input.FirstImage != "" && input.LastImage == "" {
		input.ReferenceImages = append([]string{input.FirstImage}, input.ReferenceImages...)
		input.FirstImage = ""
	}
	return metadata, nil
}

func mergeImageReferences(remote, local []string, order []imageReferencePosition) ([]string, error) {
	if len(order) == 0 {
		return append(append([]string(nil), remote...), local...), nil
	}
	if len(order) != len(remote)+len(local) {
		return nil, errors.New("image reference order must include every remote and local reference")
	}
	result := make([]string, 0, len(order))
	seenRemote := make(map[int]bool, len(remote))
	seenLocal := make(map[int]bool, len(local))
	for _, position := range order {
		switch strings.ToLower(strings.TrimSpace(position.Source)) {
		case "remote":
			if position.Index < 0 || position.Index >= len(remote) || seenRemote[position.Index] {
				return nil, errors.New("invalid or duplicate remote image reference position")
			}
			seenRemote[position.Index] = true
			result = append(result, remote[position.Index])
		case "local":
			if position.Index < 0 || position.Index >= len(local) || seenLocal[position.Index] {
				return nil, errors.New("invalid or duplicate local image reference position")
			}
			seenLocal[position.Index] = true
			result = append(result, local[position.Index])
		default:
			return nil, errors.New("image reference source must be remote or local")
		}
	}
	return result, nil
}

func saveImageResult(outputDir string, result *models.ImageResult) (string, error) {
	outputDir = strings.TrimSpace(outputDir)
	if outputDir == "" {
		return "", errors.New("outputDir is required")
	}
	if !filepath.IsAbs(outputDir) {
		return "", errors.New("outputDir must be absolute")
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", err
	}
	extension := ".png"
	switch strings.ToLower(result.ContentType) {
	case "image/jpeg", "image/jpg":
		extension = ".jpg"
	case "image/webp":
		extension = ".webp"
	}
	name := fmt.Sprintf("%s-%d%s", sanitize(result.TaskID), time.Now().UTC().UnixMilli(), extension)
	target := filepath.Join(outputDir, name)
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, result.Content, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	return target, nil
}

func saveVideoResult(outputDir string, result *models.VideoResult) (string, error) {
	extension := ".mp4"
	switch strings.ToLower(result.ContentType) {
	case "video/webm":
		extension = ".webm"
	case "video/quicktime":
		extension = ".mov"
	}
	return saveContent(outputDir, result.TaskID, extension, result.Content)
}

func saveContent(outputDir, taskID, extension string, content []byte) (string, error) {
	outputDir = strings.TrimSpace(outputDir)
	if outputDir == "" {
		return "", errors.New("outputDir is required")
	}
	if !filepath.IsAbs(outputDir) {
		return "", errors.New("outputDir must be absolute")
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", err
	}
	target := filepath.Join(outputDir, fmt.Sprintf("%s-%d%s", sanitize(taskID), time.Now().UTC().UnixMilli(), extension))
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, content, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return "", err
	}
	return target, nil
}

func sanitize(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "image"
	}
	return strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, value)
}
