package tmlabtasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/models"
)

const (
	Seedance20Mini   = "seedance-2.0-mini"
	Seedance20Fast   = "seedance-2.0-fast"
	Seedance20Pro    = "seedance-2.0-pro"
	Seedance20Pro431 = "seedance-2.0-pro(431)"
)

var seedanceModels = map[string]bool{Seedance20Mini: true, Seedance20Fast: true, Seedance20Pro: true, Seedance20Pro431: true}
var videoModes = map[string]bool{"text2video": true, "image2video": true, "mixed2video": true}
var videoRatios = map[string]bool{"adaptive": true, "16:9": true, "4:3": true, "1:1": true, "3:4": true, "9:16": true, "21:9": true}
var videoResolutions = map[string]bool{"480p": true, "720p": true}

type videoTaskResponse struct {
	TaskID        string          `json:"task_id"`
	ID            string          `json:"id"`
	Status        string          `json:"status"`
	Progress      json.RawMessage `json:"progress"`
	ResultURL     string          `json:"result_url"`
	RemoteURL     string          `json:"remote_url"`
	FailureReason string          `json:"failure_reason"`
	Message       string          `json:"message"`
	Error         any             `json:"error"`
	Metadata      map[string]any  `json:"metadata"`
	Data          map[string]any  `json:"data"`
	Result        map[string]any  `json:"result"`
	Output        map[string]any  `json:"output"`
	URL           string          `json:"url"`
	VideoURL      string          `json:"video_url"`
}

func (c *Client) GenerateVideo(ctx context.Context, request models.VideoRequest, emit models.ProgressFunc) (*models.VideoResult, error) {
	if !seedanceModels[request.Model] {
		return nil, fmt.Errorf("unsupported Seedance model: %s", request.Model)
	}
	if request.Model == Seedance20Pro431 {
		return c.generateVideoPro431(ctx, request, emit)
	}
	if !videoModes[request.ModeType] {
		return nil, fmt.Errorf("unsupported mode_type %q", request.ModeType)
	}
	if !videoRatios[request.Ratio] {
		return nil, fmt.Errorf("unsupported ratio %q", request.Ratio)
	}
	if !videoResolutions[request.Resolution] {
		return nil, fmt.Errorf("unsupported resolution %q", request.Resolution)
	}
	if request.Duration < 4 || request.Duration > 15 {
		return nil, fmt.Errorf("duration must be between 4 and 15 seconds")
	}
	if request.EnableSound != "on" && request.EnableSound != "off" {
		return nil, fmt.Errorf("enable_sound must be on or off")
	}
	if len([]rune(request.Prompt)) > 3000 {
		return nil, fmt.Errorf("video prompt exceeds 3000 characters")
	}
	if err := validateVideoReferences(request); err != nil {
		return nil, err
	}
	payload := map[string]any{
		"model": request.Model, "prompt": request.Prompt, "mode_type": request.ModeType,
		"ratio": request.Ratio, "resolution": request.Resolution, "duration": request.Duration,
		"enable_sound": request.EnableSound,
	}
	if len(request.ImageURLs) > 0 {
		payload["image_urls"] = request.ImageURLs
	}
	if len(request.AudioURLs) > 0 {
		payload["audio_urls"] = request.AudioURLs
	}
	if len(request.MixedList) > 0 {
		payload["mixed_list"] = request.MixedList
	}
	for key, value := range request.Parameters {
		if _, reserved := payload[key]; !reserved {
			payload[key] = value
		}
	}
	emitProgress(emit, "submitting", .02, "正在提交视频生成任务")
	var created videoTaskResponse
	if err := c.jsonRequest(ctx, http.MethodPost, "/v1/tasks", payload, &created); err != nil {
		return nil, err
	}
	taskID := firstNonEmpty(created.TaskID, created.ID)
	if taskID == "" {
		return nil, errors.New("Seedance create task response has no task id")
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var current videoTaskResponse
		if err := c.jsonRequest(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(taskID), nil, &current); err != nil {
			return nil, err
		}
		progress := parseVideoProgress(current.Progress)
		status := strings.ToUpper(strings.TrimSpace(current.Status))
		emitProgress(emit, strings.ToLower(status), progress, "视频生成中")
		switch status {
		case "SUCCESS", "SUCCEEDED", "COMPLETED":
			resultURL := firstNonEmpty(current.ResultURL, current.URL, current.VideoURL, nestedMediaURL(current.Metadata), nestedMediaURL(current.Data), nestedMediaURL(current.Result), nestedMediaURL(current.Output), current.RemoteURL)
			var content []byte
			var contentType string
			var err error
			if resultURL != "" {
				content, contentType, err = c.downloadVideo(ctx, resultURL)
			}
			if resultURL == "" || err != nil {
				content, contentType, err = c.downloadVideoTaskContent(ctx, taskID)
				if resultURL == "" {
					resultURL = c.baseURL + "/v1/tasks/" + url.PathEscape(taskID) + "/content"
				}
			}
			if err != nil {
				return nil, fmt.Errorf("completed Seedance task %s has no downloadable result: %w", taskID, err)
			}
			emitProgress(emit, "completed", 1, "视频生成完成")
			return &models.VideoResult{TaskID: taskID, Status: "completed", Progress: 1, URL: resultURL, RemoteURL: current.RemoteURL, ContentType: contentType, Content: content}, nil
		case "FAILURE", "FAILED", "ERROR", "CANCELLED":
			reason := firstNonEmpty(
				strings.TrimSpace(current.FailureReason), strings.TrimSpace(current.Message),
				nestedFailureReason(current.Error), nestedFailureReason(current.Data),
				nestedFailureReason(current.Metadata), nestedFailureReason(current.Result), nestedFailureReason(current.Output),
			)
			if reason == "" {
				reason = "模型平台返回失败，但查询接口未提供失败原因（请在平台任务详情中查看算力或审核状态）"
			}
			return nil, fmt.Errorf("Seedance task %s failed: %s", taskID, reason)
		}
		if err := wait(ctx, c.poll); err != nil {
			return nil, err
		}
	}
}

func (c *Client) generateVideoPro431(ctx context.Context, request models.VideoRequest, emit models.ProgressFunc) (*models.VideoResult, error) {
	if len([]rune(request.Prompt)) > 5000 {
		return nil, fmt.Errorf("video prompt exceeds 5000 characters")
	}
	if request.Duration < 4 || request.Duration > 15 {
		return nil, fmt.Errorf("duration must be between 4 and 15 seconds")
	}
	if request.Resolution != "720p" {
		return nil, fmt.Errorf("seedance-2.0-pro(431) only supports 720p")
	}
	if request.Ratio != "16:9" && request.Ratio != "9:16" && request.Ratio != "1:1" {
		return nil, fmt.Errorf("seedance-2.0-pro(431) unsupported ratio %q", request.Ratio)
	}
	if err := validatePro431References(request); err != nil {
		return nil, err
	}
	payload := map[string]any{
		"model": request.Model, "prompt": request.Prompt, "duration": request.Duration,
		"ratio": request.Ratio, "resolution": request.Resolution,
	}
	if request.FirstImage != "" {
		payload["first_image"] = request.FirstImage
	}
	if request.LastImage != "" {
		payload["last_image"] = request.LastImage
	}
	if len(request.ReferenceImages) > 0 {
		payload["referenceImages"] = request.ReferenceImages
	}
	if len(request.ReferenceVideos) > 0 {
		payload["referenceVideos"] = request.ReferenceVideos
	}
	if len(request.ReferenceAudios) > 0 {
		payload["referenceAudios"] = request.ReferenceAudios
	}
	for key, value := range request.Parameters {
		if _, reserved := payload[key]; !reserved {
			payload[key] = value
		}
	}
	return c.submitAndPollVideo(ctx, request.Model, payload, emit, 30*time.Second)
}

func validatePro431References(request models.VideoRequest) error {
	pairedFrames := request.FirstImage != "" || request.LastImage != ""
	if pairedFrames && (request.FirstImage == "" || request.LastImage == "") {
		return errors.New("seedance-2.0-pro(431) first_image and last_image must be provided together")
	}
	if pairedFrames && len(request.ReferenceImages)+len(request.ReferenceVideos)+len(request.ReferenceAudios) > 0 {
		return errors.New("seedance-2.0-pro(431) first/last frame mode cannot be combined with reference materials")
	}
	if len(request.ReferenceImages) > 4 {
		return errors.New("seedance-2.0-pro(431) supports at most 4 reference images")
	}
	if len(request.ReferenceVideos) > 3 {
		return errors.New("seedance-2.0-pro(431) supports at most 3 reference videos")
	}
	if len(request.ReferenceAudios) > 1 {
		return errors.New("seedance-2.0-pro(431) supports at most 1 reference audio")
	}
	values := append([]string{request.FirstImage, request.LastImage}, request.ReferenceImages...)
	values = append(values, request.ReferenceVideos...)
	values = append(values, request.ReferenceAudios...)
	for _, value := range values {
		if value != "" && !publicHTTPURL(value) {
			return fmt.Errorf("reference URL must use HTTP or HTTPS: %q", value)
		}
	}
	return nil
}

func (c *Client) submitAndPollVideo(ctx context.Context, model string, payload map[string]any, emit models.ProgressFunc, pollInterval time.Duration) (*models.VideoResult, error) {
	emitProgress(emit, "submitting", .02, "正在提交视频生成任务")
	var created videoTaskResponse
	if err := c.jsonRequest(ctx, http.MethodPost, "/v1/tasks", payload, &created); err != nil {
		return nil, err
	}
	taskID := firstNonEmpty(created.TaskID, created.ID)
	if taskID == "" {
		return nil, errors.New("Seedance create task response has no task id")
	}
	if pollInterval < c.poll {
		pollInterval = c.poll
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var current videoTaskResponse
		if err := c.jsonRequest(ctx, http.MethodGet, "/v1/tasks/"+url.PathEscape(taskID), nil, &current); err != nil {
			return nil, err
		}
		progress := parseVideoProgress(current.Progress)
		status := strings.ToUpper(strings.TrimSpace(current.Status))
		emitProgress(emit, strings.ToLower(status), progress, "视频生成中")
		switch status {
		case "SUCCESS", "SUCCEEDED", "COMPLETED":
			resultURL := firstNonEmpty(current.ResultURL, current.URL, current.VideoURL, nestedMediaURL(current.Metadata), nestedMediaURL(current.Data), nestedMediaURL(current.Result), nestedMediaURL(current.Output), current.RemoteURL)
			var content []byte
			var contentType string
			var err error
			if resultURL != "" {
				content, contentType, err = c.downloadVideo(ctx, resultURL)
			}
			if resultURL == "" || err != nil {
				content, contentType, err = c.downloadVideoTaskContent(ctx, taskID)
				if resultURL == "" {
					resultURL = c.baseURL + "/v1/tasks/" + url.PathEscape(taskID) + "/content"
				}
			}
			if err != nil {
				return nil, fmt.Errorf("completed Seedance task %s has no downloadable result: %w", taskID, err)
			}
			emitProgress(emit, "completed", 1, "视频生成完成")
			return &models.VideoResult{TaskID: taskID, Status: "completed", Progress: 1, URL: resultURL, RemoteURL: firstNonEmpty(current.VideoURL, current.RemoteURL), ContentType: contentType, Content: content}, nil
		case "FAILURE", "FAILED", "ERROR", "CANCELLED":
			reason := firstNonEmpty(strings.TrimSpace(current.FailureReason), strings.TrimSpace(current.Message), nestedFailureReason(current.Error), nestedFailureReason(current.Data), nestedFailureReason(current.Metadata), nestedFailureReason(current.Result), nestedFailureReason(current.Output))
			if reason == "" {
				reason = "模型平台返回失败，但查询接口未提供失败原因"
			}
			return nil, fmt.Errorf("Seedance task %s failed: %s", taskID, reason)
		}
		if err := wait(ctx, pollInterval); err != nil {
			return nil, err
		}
	}
}

func nestedFailureReason(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"failure_reason", "message", "detail", "reason", "error_message"} {
			if text, ok := typed[key].(string); ok && strings.TrimSpace(text) != "" {
				return strings.TrimSpace(text)
			}
		}
		for _, item := range typed {
			if reason := nestedFailureReason(item); reason != "" {
				return reason
			}
		}
	case []any:
		for _, item := range typed {
			if reason := nestedFailureReason(item); reason != "" {
				return reason
			}
		}
	case string:
		return strings.TrimSpace(typed)
	}
	return ""
}

func nestedMediaURL(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"result_url", "video_url", "url", "download_url", "file_url", "remote_url"} {
			if result := nestedMediaURL(typed[key]); result != "" {
				return result
			}
		}
		for _, item := range typed {
			if result := nestedMediaURL(item); result != "" {
				return result
			}
		}
	case []any:
		for _, item := range typed {
			if result := nestedMediaURL(item); result != "" {
				return result
			}
		}
	case string:
		if publicHTTPURL(typed) {
			return strings.TrimSpace(typed)
		}
	}
	return ""
}

func validateVideoReferences(request models.VideoRequest) error {
	if len(request.ImageURLs) > 9 {
		return errors.New("image_urls supports at most 9 items")
	}
	if len(request.AudioURLs) > 3 {
		return errors.New("audio_urls supports at most 3 items")
	}
	if len(request.MixedList) > 15 {
		return errors.New("mixed_list supports at most 15 items")
	}
	switch request.ModeType {
	case "text2video":
		if len(request.ImageURLs)+len(request.AudioURLs)+len(request.MixedList) > 0 {
			return errors.New("text2video does not accept reference assets")
		}
	case "image2video":
		if len(request.ImageURLs) == 0 {
			return errors.New("image2video requires at least one image URL")
		}
		if len(request.MixedList) > 0 {
			return errors.New("image2video does not accept mixed_list")
		}
	case "mixed2video":
		if len(request.MixedList) == 0 {
			return errors.New("mixed2video requires mixed_list")
		}
		if len(request.ImageURLs) > 0 {
			return errors.New("mixed2video does not accept image_urls")
		}
	}
	for _, value := range append(append([]string{}, request.ImageURLs...), request.AudioURLs...) {
		if !publicHTTPURL(value) {
			return fmt.Errorf("reference URL must use HTTP or HTTPS: %q", value)
		}
	}
	for _, item := range request.MixedList {
		if !publicHTTPURL(item.URL) {
			return fmt.Errorf("mixed reference URL must use HTTP or HTTPS: %q", item.URL)
		}
		if item.Type != "image" && item.Type != "video" && item.Type != "audio" {
			return fmt.Errorf("unsupported mixed reference type %q", item.Type)
		}
	}
	return nil
}

func publicHTTPURL(value string) bool {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func parseVideoProgress(raw json.RawMessage) float64 {
	text := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	text = strings.TrimSuffix(text, "%")
	value, _ := strconv.ParseFloat(text, 64)
	return clamp(value/100, 0, 1)
}

func (c *Client) downloadVideo(ctx context.Context, target string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("download generated video: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 512<<20))
	if err != nil {
		return nil, "", err
	}
	if len(data) == 0 {
		return nil, "", errors.New("downloaded video is empty")
	}
	return data, strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]), nil
}

func (c *Client) downloadVideoTaskContent(ctx context.Context, taskID string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/tasks/"+url.PathEscape(taskID)+"/content", nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("content endpoint HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 512<<20))
	if err != nil {
		return nil, "", err
	}
	if len(data) == 0 {
		return nil, "", errors.New("downloaded video is empty")
	}
	return data, strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]), nil
}
