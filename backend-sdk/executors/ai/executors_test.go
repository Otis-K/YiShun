package aiexec

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/flowcanvas/flowcanvas-backend-sdk/asset"
	"github.com/flowcanvas/flowcanvas-backend-sdk/builtin"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
)

type fakeGenerator struct {
	calls int
}

func (f *fakeGenerator) GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (map[string]any, string, error) {
	f.calls++
	switch {
	case strings.Contains(systemPrompt, "文本生成"):
		return map[string]any{"text": "扩展后的霓虹故事", "title": "故事", "styleTags": []any{"电影感"}}, `{"text":"扩展后的霓虹故事"}`, nil
	case strings.Contains(systemPrompt, "图片生成"):
		return map[string]any{"prompt": "雨夜街道", "aspectRatio": "16:9", "resolution": "2K"}, `{"prompt":"雨夜街道"}`, nil
	case strings.Contains(systemPrompt, "视频生成"):
		return map[string]any{"prompt": "镜头推进", "durationSec": 5, "timeline": []any{}}, `{"prompt":"镜头推进"}`, nil
	case strings.Contains(systemPrompt, "音频生成"):
		return map[string]any{"audioType": "voiceover", "durationSec": 5}, `{"audioType":"voiceover"}`, nil
	case strings.Contains(systemPrompt, "镜头合成"):
		return map[string]any{"title": "成片", "tracks": []any{}, "export": map[string]any{"format": "mp4"}}, `{"title":"成片"}`, nil
	default:
		return nil, "", fmt.Errorf("unexpected prompt: %s", systemPrompt)
	}
}

func TestAIExecutorsRunFullProductionChain(t *testing.T) {
	store, err := asset.NewFileStore(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	gen := &fakeGenerator{}
	engine := runtime.NewEngine(builtin.Registry())
	if err := RegisterExecutors(engine, Config{Client: gen, AssetStore: store}); err != nil {
		t.Fatal(err)
	}
	result, err := engine.RunGraph(context.Background(), builtin.ProductionGraph(), runtime.RunOptions{StopOnError: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != runtime.StatusSucceeded {
		t.Fatalf("unexpected status: %s", result.Status)
	}
	if gen.calls != 5 {
		t.Fatalf("expected 5 model calls, got %d", gen.calls)
	}
	for nodeID, port := range map[string]string{
		"image-1":   "image",
		"video-1":   "video",
		"audio-1":   "audio",
		"compose-1": "output",
	} {
		value, ok := result.Outputs[nodeID][port].(map[string]any)
		if !ok {
			t.Fatalf("missing asset output for %s.%s: %#v", nodeID, port, result.Outputs[nodeID])
		}
		if value["path"] == "" || value["sha256"] == "" {
			t.Fatalf("asset output incomplete for %s.%s: %#v", nodeID, port, value)
		}
	}
}
