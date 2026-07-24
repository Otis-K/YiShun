package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAIClientGenerateJSON(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("missing auth header")
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req["model"] != "test-model" {
			t.Fatalf("unexpected model: %v", req["model"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{
				"message": map[string]any{"content": `{"title":"ok","items":[1,2]}`},
			}},
		})
	}))
	defer server.Close()
	client, err := NewOpenAIClient(Config{BaseURL: server.URL, APIKey: "test-key", Model: "test-model"})
	if err != nil {
		t.Fatal(err)
	}
	parsed, raw, err := client.GenerateJSON(context.Background(), "system", "user")
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v1/chat/completions" {
		t.Fatalf("unexpected path: %s", gotPath)
	}
	if parsed["title"] != "ok" || !strings.Contains(raw, "ok") {
		t.Fatalf("unexpected parsed response: %+v raw=%s", parsed, raw)
	}
}

func TestParseJSONObjectFromMarkdownishResponse(t *testing.T) {
	parsed, err := ParseJSONObject("好的：\n```json\n{\"ok\":true}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if parsed["ok"] != true {
		t.Fatalf("unexpected parsed object: %+v", parsed)
	}
}
