package models

import (
	"context"
	"testing"
)

type imageGeneratorFunc func(context.Context, ImageRequest, ProgressFunc) (*ImageResult, error)
type videoGeneratorFunc func(context.Context, VideoRequest, ProgressFunc) (*VideoResult, error)

func (f imageGeneratorFunc) GenerateImage(ctx context.Context, request ImageRequest, emit ProgressFunc) (*ImageResult, error) {
	return f(ctx, request, emit)
}

func (f videoGeneratorFunc) GenerateVideo(ctx context.Context, request VideoRequest, emit ProgressFunc) (*VideoResult, error) {
	return f(ctx, request, emit)
}

func TestServiceRoutesExactModelWithoutOverwritingParameters(t *testing.T) {
	registry := NewRegistry()
	var captured ImageRequest
	err := registry.Register(Model{ID: "model-a", Provider: "provider-a", Image: imageGeneratorFunc(func(_ context.Context, request ImageRequest, _ ProgressFunc) (*ImageResult, error) {
		captured = request
		return &ImageResult{TaskID: "task-1", Status: "completed", URL: "https://example.test/image.png", Content: []byte("png")}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	service, _ := NewService(registry)
	result, err := service.GenerateImage(context.Background(), ImageRequest{Model: "model-a", Prompt: "hello", Size: "4K", AspectRatio: "21:9", Parameters: map[string]any{"custom": "keep"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if captured.Size != "4K" || captured.AspectRatio != "21:9" || captured.Parameters["custom"] != "keep" {
		t.Fatalf("request was changed: %#v", captured)
	}
	if result.Provider != "provider-a" || result.Model != "model-a" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestServiceRejectsModelWithoutImageCapability(t *testing.T) {
	registry := NewRegistry()
	if err := registry.Register(Model{ID: "video-only", Provider: "provider-a", Video: videoGeneratorFunc(func(context.Context, VideoRequest, ProgressFunc) (*VideoResult, error) {
		return &VideoResult{URL: "https://example.test/video.mp4", Content: []byte("video")}, nil
	})}); err != nil {
		t.Fatal(err)
	}
	service, _ := NewService(registry)
	if _, err := service.GenerateImage(context.Background(), ImageRequest{Model: "video-only", Prompt: "hello"}, nil); err == nil {
		t.Fatal("expected image capability error")
	}
}
