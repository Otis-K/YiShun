package tmlabtasks

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/models"
)

func TestGenerateImageSubmitsPollsAndDownloads(t *testing.T) {
	image := []byte("real-image-bytes")
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/tasks":
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			if payload["model"] != NanoBananaProSpecial1 || payload["size"] != "2K" {
				t.Errorf("unexpected payload: %#v", payload)
			}
			metadata := payload["metadata"].(map[string]any)
			if metadata["aspectRatio"] != "16:9" {
				t.Errorf("unexpected metadata: %#v", metadata)
			}
			if len(payload["images"].([]any)) != 2 || payload["custom"] != "kept" {
				t.Errorf("references or custom parameters lost: %#v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "task-1", "status": "queued"})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/tasks/task-1":
			polls++
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "task-1", "status": "completed", "progress": 100, "metadata": map[string]any{"url": serverURL(r) + "/result.png"}})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/tasks/task-1/content":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(image)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, APIKey: "secret", PollInterval: time.Millisecond, HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.GenerateImage(context.Background(), models.ImageRequest{
		Model: NanoBananaProSpecial1, Prompt: "test", Size: "2K", AspectRatio: "16:9",
		Images: []string{"https://example.com/one.png", "https://example.com/two.png"}, Parameters: map[string]any{"custom": "kept"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.TaskID != "task-1" || string(result.Content) != string(image) || polls != 1 {
		t.Fatalf("unexpected result: %#v polls=%d", result, polls)
	}
}

func TestGenerateImageAcceptsDocumentedSizeAndRatioMatrix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "matrix", "status": "queued"})
		case http.MethodGet:
			if r.URL.Path == "/v1/tasks/matrix/content" {
				w.Header().Set("Content-Type", "image/png")
				_, _ = w.Write([]byte("png"))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "matrix", "status": "completed", "progress": 100, "metadata": map[string]any{"url": serverURL(r) + "/result.png"}})
		}
	}))
	defer server.Close()
	client, _ := New(Config{BaseURL: server.URL, APIKey: "secret", PollInterval: time.Millisecond, HTTPClient: server.Client()})
	for _, size := range []string{"1K", "2K", "4K"} {
		for _, ratio := range []string{"auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"} {
			if _, err := client.GenerateImage(context.Background(), models.ImageRequest{Model: NanoBananaProSpecial1, Prompt: "matrix", Size: size, AspectRatio: ratio}, nil); err != nil {
				t.Fatalf("%s/%s: %v", size, ratio, err)
			}
		}
	}
}

func TestGenerateImageRejectsUndocumentedSizeAndRatio(t *testing.T) {
	client, _ := New(Config{BaseURL: "https://example.com", APIKey: "secret"})
	for _, request := range []models.ImageRequest{
		{Model: NanoBananaProSpecial1, Prompt: "x", Size: "8K", AspectRatio: "1:1"},
		{Model: NanoBananaProSpecial1, Prompt: "x", Size: "1K", AspectRatio: "7:5"},
	} {
		if _, err := client.GenerateImage(context.Background(), request, nil); err == nil {
			t.Fatalf("expected validation error for %#v", request)
		}
	}
}

func serverURL(r *http.Request) string { return "http://" + r.Host }
