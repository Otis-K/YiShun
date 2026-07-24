package models

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
)

type Capability string

const CapabilityImageGeneration Capability = "image-generation"
const CapabilityVideoGeneration Capability = "video-generation"

type Progress struct {
	Status   string  `json:"status"`
	Progress float64 `json:"progress"`
	Message  string  `json:"message,omitempty"`
}

type ProgressFunc func(Progress)

type ImageRequest struct {
	Model       string         `json:"model"`
	Prompt      string         `json:"prompt"`
	Size        string         `json:"size,omitempty"`
	Images      []string       `json:"images,omitempty"`
	AspectRatio string         `json:"aspectRatio,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

type ImageResult struct {
	Provider    string         `json:"provider"`
	Model       string         `json:"model"`
	TaskID      string         `json:"taskId"`
	Status      string         `json:"status"`
	Progress    float64        `json:"progress"`
	URL         string         `json:"url"`
	ContentType string         `json:"contentType,omitempty"`
	Content     []byte         `json:"-"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type ImageGenerator interface {
	GenerateImage(context.Context, ImageRequest, ProgressFunc) (*ImageResult, error)
}

type MixedMedia struct {
	URL  string `json:"url"`
	Type string `json:"type"`
}

type VideoRequest struct {
	Model           string         `json:"model"`
	Prompt          string         `json:"prompt"`
	ModeType        string         `json:"modeType"`
	Ratio           string         `json:"ratio"`
	Resolution      string         `json:"resolution"`
	Duration        int            `json:"duration"`
	EnableSound     string         `json:"enableSound"`
	ImageURLs       []string       `json:"imageUrls,omitempty"`
	AudioURLs       []string       `json:"audioUrls,omitempty"`
	MixedList       []MixedMedia   `json:"mixedList,omitempty"`
	FirstImage      string         `json:"firstImage,omitempty"`
	LastImage       string         `json:"lastImage,omitempty"`
	ReferenceImages []string       `json:"referenceImages,omitempty"`
	ReferenceVideos []string       `json:"referenceVideos,omitempty"`
	ReferenceAudios []string       `json:"referenceAudios,omitempty"`
	Parameters      map[string]any `json:"parameters,omitempty"`
}

type VideoResult struct {
	Provider    string         `json:"provider"`
	Model       string         `json:"model"`
	TaskID      string         `json:"taskId"`
	Status      string         `json:"status"`
	Progress    float64        `json:"progress"`
	URL         string         `json:"url"`
	RemoteURL   string         `json:"remoteUrl,omitempty"`
	ContentType string         `json:"contentType,omitempty"`
	Content     []byte         `json:"-"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type VideoGenerator interface {
	GenerateVideo(context.Context, VideoRequest, ProgressFunc) (*VideoResult, error)
}

type Model struct {
	ID           string       `json:"id"`
	Provider     string       `json:"provider"`
	Capabilities []Capability `json:"capabilities"`
	Image        ImageGenerator
	Video        VideoGenerator
}

type Registry struct {
	mu     sync.RWMutex
	models map[string]Model
}

func NewRegistry() *Registry { return &Registry{models: map[string]Model{}} }

func (r *Registry) Register(model Model) error {
	if r == nil {
		return errors.New("model registry is nil")
	}
	model.ID = strings.TrimSpace(model.ID)
	if model.ID == "" {
		return errors.New("model id is required")
	}
	if model.Image == nil && model.Video == nil {
		return fmt.Errorf("model %q has no generator", model.ID)
	}
	if model.Provider == "" {
		return fmt.Errorf("model %q provider is required", model.ID)
	}
	model.Capabilities = nil
	if model.Image != nil {
		model.Capabilities = append(model.Capabilities, CapabilityImageGeneration)
	}
	if model.Video != nil {
		model.Capabilities = append(model.Capabilities, CapabilityVideoGeneration)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.models[model.ID]; exists {
		return fmt.Errorf("model already registered: %s", model.ID)
	}
	r.models[model.ID] = model
	return nil
}

func (r *Registry) Get(id string) (Model, bool) {
	if r == nil {
		return Model{}, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	model, ok := r.models[strings.TrimSpace(id)]
	return model, ok
}

type Service struct{ registry *Registry }

func NewService(registry *Registry) (*Service, error) {
	if registry == nil {
		return nil, errors.New("model registry is required")
	}
	return &Service{registry: registry}, nil
}

func (s *Service) GenerateImage(ctx context.Context, request ImageRequest, progress ProgressFunc) (*ImageResult, error) {
	if s == nil || s.registry == nil {
		return nil, errors.New("model service is not configured")
	}
	request.Model = strings.TrimSpace(request.Model)
	request.Prompt = strings.TrimSpace(request.Prompt)
	if request.Model == "" {
		return nil, errors.New("image model is required")
	}
	if request.Prompt == "" {
		return nil, errors.New("image prompt is required")
	}
	if len(request.Images) > 14 {
		return nil, errors.New("image generation accepts at most 14 reference images")
	}
	model, ok := s.registry.Get(request.Model)
	if !ok {
		return nil, fmt.Errorf("image model is not registered: %s", request.Model)
	}
	if model.Image == nil {
		return nil, fmt.Errorf("model %s does not support image generation", request.Model)
	}
	result, err := model.Image.GenerateImage(ctx, request, progress)
	if err != nil {
		return nil, fmt.Errorf("generate image with %s: %w", request.Model, err)
	}
	if result == nil || strings.TrimSpace(result.URL) == "" || len(result.Content) == 0 {
		return nil, fmt.Errorf("image model %s returned an incomplete result", request.Model)
	}
	result.Provider = model.Provider
	result.Model = model.ID
	return result, nil
}

func (s *Service) GenerateVideo(ctx context.Context, request VideoRequest, progress ProgressFunc) (*VideoResult, error) {
	if s == nil || s.registry == nil {
		return nil, errors.New("model service is not configured")
	}
	request.Model = strings.TrimSpace(request.Model)
	request.Prompt = strings.TrimSpace(request.Prompt)
	if request.Model == "" {
		return nil, errors.New("video model is required")
	}
	if request.Prompt == "" {
		return nil, errors.New("video prompt is required")
	}
	model, ok := s.registry.Get(request.Model)
	if !ok {
		return nil, fmt.Errorf("video model is not registered: %s", request.Model)
	}
	if model.Video == nil {
		return nil, fmt.Errorf("model %s does not support video generation", request.Model)
	}
	result, err := model.Video.GenerateVideo(ctx, request, progress)
	if err != nil {
		return nil, fmt.Errorf("generate video with %s: %w", request.Model, err)
	}
	if result == nil || strings.TrimSpace(result.URL) == "" || len(result.Content) == 0 {
		return nil, fmt.Errorf("video model %s returned an incomplete result", request.Model)
	}
	result.Provider = model.Provider
	result.Model = model.ID
	return result, nil
}
