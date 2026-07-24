package tmlabtasks

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/models"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func TestGenerateVideoRetriesTransientSubmitEOFWithStableIdempotencyKey(t *testing.T) {
	attempts := 0
	keys := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/result.mp4" {
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
			return
		}
		if r.Method == http.MethodGet {
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "video-retry", "status": "SUCCESS", "progress": "100%", "result_url": serverURL(r) + "/result.mp4"})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	base := server.Client().Transport
	client, err := New(Config{BaseURL: server.URL, APIKey: "test", PollInterval: time.Millisecond, HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method == http.MethodPost && request.URL.Path == "/v1/tasks" {
			attempts++
			keys = append(keys, request.Header.Get("Idempotency-Key"))
			if attempts == 1 {
				return nil, io.ErrUnexpectedEOF
			}
			return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"task_id":"video-retry","status":"QUEUED"}`)), Request: request}, nil
		}
		return base.RoundTrip(request)
	})}})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.GenerateVideo(context.Background(), models.VideoRequest{Model: Seedance20Fast, Prompt: "retry", ModeType: "text2video", Ratio: "16:9", Resolution: "480p", Duration: 4, EnableSound: "off"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.TaskID != "video-retry" || attempts != 2 {
		t.Fatalf("unexpected retry result=%#v attempts=%d", result, attempts)
	}
	if keys[0] == "" || keys[0] != keys[1] {
		t.Fatalf("idempotency key changed across retries: %#v", keys)
	}
}

func TestGenerateVideoPreservesAllSupportedParametersAndNormalizesResult(t *testing.T) {
	video := []byte("fake-mp4")
	var submitted map[string]any
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/tasks":
			_ = json.NewDecoder(r.Body).Decode(&submitted)
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "video-1", "status": "QUEUED"})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/tasks/video-1":
			polls++
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "video-1", "status": "SUCCESS", "progress": "100%", "result_url": serverURL(r) + "/result.mp4", "remote_url": "https://remote.example/original.mp4"})
		case r.Method == http.MethodGet && r.URL.Path == "/result.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write(video)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := New(Config{BaseURL: server.URL, APIKey: "test", PollInterval: time.Millisecond, HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.GenerateVideo(context.Background(), models.VideoRequest{
		Model: Seedance20Fast, Prompt: "camera move", ModeType: "image2video", Ratio: "21:9",
		Resolution: "720p", Duration: 15, EnableSound: "on",
		ImageURLs: []string{"https://example.com/first.png", "https://example.com/last.png"},
		AudioURLs: []string{"https://example.com/voice.mp3"}, Parameters: map[string]any{"custom": "kept"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.TaskID != "video-1" || result.URL == "" || result.ContentType != "video/mp4" || !reflect.DeepEqual(result.Content, video) || polls != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	for key, want := range map[string]any{"model": Seedance20Fast, "prompt": "camera move", "mode_type": "image2video", "ratio": "21:9", "resolution": "720p", "duration": float64(15), "enable_sound": "on", "custom": "kept"} {
		if submitted[key] != want {
			t.Fatalf("%s: got %#v want %#v", key, submitted[key], want)
		}
	}
	if len(submitted["image_urls"].([]any)) != 2 || len(submitted["audio_urls"].([]any)) != 1 {
		t.Fatalf("references lost: %#v", submitted)
	}
}

func TestGenerateVideoPro431UsesDedicatedSchema(t *testing.T) {
	var submitted map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/tasks":
			_ = json.NewDecoder(r.Body).Decode(&submitted)
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "pro-431", "status": "QUEUED"})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/tasks/pro-431":
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "pro-431", "status": "SUCCESS", "video_url": serverURL(r) + "/pro.mp4"})
		case r.Method == http.MethodGet && r.URL.Path == "/pro.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("pro-video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, _ := New(Config{BaseURL: server.URL, APIKey: "test", PollInterval: time.Millisecond, HTTPClient: server.Client()})
	result, err := client.GenerateVideo(context.Background(), models.VideoRequest{
		Model: Seedance20Pro431, Prompt: "reference", Ratio: "9:16", Resolution: "720p", Duration: 8,
		ReferenceImages: []string{"https://example.com/a.png"}, ReferenceVideos: []string{"https://example.com/a.mp4"}, ReferenceAudios: []string{"https://example.com/a.mp3"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.TaskID != "pro-431" || string(result.Content) != "pro-video" {
		t.Fatalf("unexpected result: %#v", result)
	}
	for _, forbidden := range []string{"mode_type", "enable_sound", "image_urls", "audio_urls", "mixed_list"} {
		if _, ok := submitted[forbidden]; ok {
			t.Fatalf("legacy field %s leaked into pro payload: %#v", forbidden, submitted)
		}
	}
	if submitted["model"] != Seedance20Pro431 || submitted["resolution"] != "720p" || len(submitted["referenceImages"].([]any)) != 1 || len(submitted["referenceVideos"].([]any)) != 1 || len(submitted["referenceAudios"].([]any)) != 1 {
		t.Fatalf("unexpected pro payload: %#v", submitted)
	}
}

func TestGenerateVideoValidation(t *testing.T) {
	client, _ := New(Config{BaseURL: "https://example.com", APIKey: "test"})
	cases := []models.VideoRequest{
		{Model: Seedance20Fast, Prompt: "x", ModeType: "text2video", Ratio: "16:9", Resolution: "1080p", Duration: 5, EnableSound: "off"},
		{Model: Seedance20Fast, Prompt: "x", ModeType: "image2video", Ratio: "16:9", Resolution: "480p", Duration: 5, EnableSound: "off"},
		{Model: Seedance20Fast, Prompt: "x", ModeType: "text2video", Ratio: "16:9", Resolution: "480p", Duration: 3, EnableSound: "off"},
		{Model: Seedance20Pro431, Prompt: "x", Ratio: "16:9", Resolution: "480p", Duration: 5},
		{Model: Seedance20Pro431, Prompt: "x", Ratio: "4:3", Resolution: "720p", Duration: 5},
		{Model: Seedance20Pro431, Prompt: "x", Ratio: "16:9", Resolution: "720p", Duration: 5, FirstImage: "https://example.com/a.png"},
	}
	for _, request := range cases {
		if _, err := client.GenerateVideo(context.Background(), request, nil); err == nil {
			t.Fatalf("expected validation error for %#v", request)
		}
	}
}

func TestPro431ReferenceRules(t *testing.T) {
	valid := []models.VideoRequest{
		{FirstImage: "https://example.com/first.png", LastImage: "https://example.com/last.png"},
		{ReferenceImages: []string{"https://example.com/1.png", "https://example.com/2.png"}, ReferenceVideos: []string{"https://example.com/1.mp4"}, ReferenceAudios: []string{"https://example.com/1.mp3"}},
	}
	for _, request := range valid {
		if err := validatePro431References(request); err != nil {
			t.Fatalf("valid request rejected: %v", err)
		}
	}
	invalid := []models.VideoRequest{
		{FirstImage: "https://example.com/first.png"},
		{LastImage: "https://example.com/last.png"},
		{FirstImage: "https://example.com/first.png", ReferenceImages: []string{"https://example.com/ref.png"}},
		{ReferenceAudios: []string{"https://example.com/1.mp3", "https://example.com/2.mp3"}},
	}
	for _, request := range invalid {
		if err := validatePro431References(request); err == nil {
			t.Fatalf("invalid request accepted: %#v", request)
		}
	}
}

func TestNestedVideoResultURL(t *testing.T) {
	value := map[string]any{"output": map[string]any{"videos": []any{map[string]any{"download_url": "https://example.com/result.mp4"}}}}
	if got := nestedMediaURL(value); got != "https://example.com/result.mp4" {
		t.Fatalf("got %q", got)
	}
}

func TestNestedVideoFailureReason(t *testing.T) {
	value := map[string]any{"error": map[string]any{"detail": "算力不足"}}
	if got := nestedFailureReason(value); got != "算力不足" {
		t.Fatalf("got %q", got)
	}
}

func TestGenerateVideoUsesExplicitFailureFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "failed-video", "status": "QUEUED"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "failed-video", "status": "FAILURE", "progress": 100})
	}))
	defer server.Close()
	client, _ := New(Config{BaseURL: server.URL, APIKey: "test", PollInterval: time.Millisecond, HTTPClient: server.Client()})
	_, err := client.GenerateVideo(context.Background(), models.VideoRequest{
		Model: Seedance20Fast, Prompt: "x", ModeType: "text2video", Ratio: "16:9", Resolution: "480p", Duration: 4, EnableSound: "off",
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "未提供失败原因") {
		t.Fatalf("unexpected error: %v", err)
	}
}
