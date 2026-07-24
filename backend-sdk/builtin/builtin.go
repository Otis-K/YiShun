package builtin

import (
	"context"
	"fmt"
	"time"

	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
	"github.com/flowcanvas/flowcanvas-backend-sdk/schema"
)

func Definitions() []schema.NodeDefinition {
	return []schema.NodeDefinition{
		{
			Type: "prompt", Title: "场景脚本", Category: "创作",
			Description: "输入脚本、提示词或镜头描述", Icon: "text", Color: "#79e6c5",
			Inputs:             []schema.PortDefinition{},
			Outputs:            []schema.PortDefinition{{ID: "text", Label: "文本", DataType: schema.DataText}},
			RequiredDataFields: []string{"prompt"},
		},
		{
			Type: "image", Title: "图片生成", Category: "生成",
			Description: "根据文本和参考素材生成画面", Icon: "image", Color: "#80aefa",
			Inputs: []schema.PortDefinition{
				{ID: "prompt", Label: "提示词", DataType: schema.DataText},
				{ID: "reference", Label: "参考图", DataType: schema.DataImage, Multiple: true},
			},
			Outputs: []schema.PortDefinition{{ID: "image", Label: "图像", DataType: schema.DataImage}},
		},
		{
			Type: "video", Title: "视频生成", Category: "生成",
			Description: "根据提示词和首尾帧生成镜头", Icon: "video", Color: "#f0ba7b",
			Inputs: []schema.PortDefinition{
				{ID: "prompt", Label: "提示词", DataType: schema.DataText},
				{ID: "image", Label: "首帧", DataType: schema.DataImage},
				{ID: "lastFrame", Label: "尾帧", DataType: schema.DataImage},
			},
			Outputs: []schema.PortDefinition{{ID: "video", Label: "视频", DataType: schema.DataVideo}},
		},
		{
			Type: "audio", Title: "音频生成", Category: "生成",
			Description: "根据描述生成音乐或角色语音", Icon: "audio", Color: "#73d6a4",
			Inputs:  []schema.PortDefinition{{ID: "text", Label: "台词", DataType: schema.DataText}},
			Outputs: []schema.PortDefinition{{ID: "audio", Label: "音频", DataType: schema.DataAudio}},
		},
		{
			Type: "compose", Title: "镜头合成", Category: "输出",
			Description: "合并视频、配音和字幕", Icon: "output", Color: "#c8ccd2",
			Inputs: []schema.PortDefinition{
				{ID: "video", Label: "视频", DataType: schema.DataVideo, Required: true},
				{ID: "audio", Label: "音频", DataType: schema.DataAudio},
			},
			Outputs: []schema.PortDefinition{{ID: "output", Label: "成片", DataType: schema.DataVideo}},
		},
	}
}

func Registry() *schema.Registry {
	return schema.MustNewRegistry(Definitions()...)
}

func RegisterExecutors(engine *runtime.Engine) {
	engine.RegisterExecutor("prompt", runtime.ExecutorFunc(promptExecutor))
	engine.RegisterExecutor("image", runtime.ExecutorFunc(imageExecutor))
	engine.RegisterExecutor("video", runtime.ExecutorFunc(videoExecutor))
	engine.RegisterExecutor("audio", runtime.ExecutorFunc(audioExecutor))
	engine.RegisterExecutor("compose", runtime.ExecutorFunc(composeExecutor))
}

func NewDemoEngine() *runtime.Engine {
	engine := runtime.NewEngine(Registry())
	RegisterExecutors(engine)
	return engine
}

func promptExecutor(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	prompt := graph.DataString(input.Node.Data, "prompt")
	emit(1, "文本已准备")
	return map[string]any{"text": prompt}, nil
}

func imageExecutor(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	if err := wait(ctx, input.Node, emit, 0.2, "解析提示词"); err != nil {
		return nil, err
	}
	if err := wait(ctx, input.Node, emit, 0.7, "生成画面"); err != nil {
		return nil, err
	}
	prompt := firstNonEmpty(input.Inputs["prompt"], graph.DataString(input.Node.Data, "prompt"))
	return map[string]any{
		"image": map[string]any{
			"kind":   "image",
			"prompt": prompt,
			"model":  firstNonEmpty(graph.DataString(input.Node.Data, "model"), "全能图片 G2"),
			"demo":   true,
		},
	}, nil
}

func videoExecutor(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	for _, step := range []struct {
		progress float64
		message  string
	}{{0.15, "准备素材"}, {0.45, "生成关键帧"}, {0.78, "合成镜头"}} {
		if err := wait(ctx, input.Node, emit, step.progress, step.message); err != nil {
			return nil, err
		}
	}
	prompt := firstNonEmpty(input.Inputs["prompt"], graph.DataString(input.Node.Data, "prompt"))
	return map[string]any{
		"video": map[string]any{
			"kind":      "video",
			"prompt":    prompt,
			"image":     input.Inputs["image"],
			"lastFrame": firstNonEmpty(input.Inputs["lastFrame"], graph.DataString(input.Node.Data, "lastFrame")),
			"model":     firstNonEmpty(graph.DataString(input.Node.Data, "model"), "Vidu Q2"),
			"duration":  graph.DataFloat(input.Node.Data, "duration", 5),
			"demo":      true,
		},
	}, nil
}

func audioExecutor(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	if err := wait(ctx, input.Node, emit, 0.5, "合成音频"); err != nil {
		return nil, err
	}
	text := firstNonEmpty(input.Inputs["text"], graph.DataString(input.Node.Data, "prompt"))
	return map[string]any{
		"audio": map[string]any{
			"kind":       "audio",
			"text":       text,
			"model":      firstNonEmpty(graph.DataString(input.Node.Data, "model"), "Mureka V9"),
			"lyricsMode": firstNonEmpty(graph.DataString(input.Node.Data, "lyricsMode"), "自动生成"),
			"demo":       true,
		},
	}, nil
}

func composeExecutor(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	if err := wait(ctx, input.Node, emit, 0.35, "对齐轨道"); err != nil {
		return nil, err
	}
	if err := wait(ctx, input.Node, emit, 0.8, "导出成片"); err != nil {
		return nil, err
	}
	return map[string]any{
		"output": map[string]any{
			"kind":       "video",
			"video":      input.Inputs["video"],
			"audio":      input.Inputs["audio"],
			"resolution": firstNonEmpty(graph.DataString(input.Node.Data, "resolution"), "1080p"),
			"demo":       true,
		},
	}, nil
}

func wait(ctx context.Context, node graph.Node, emit runtime.ProgressFunc, progress float64, message string) error {
	emit(progress, message)
	delayMs := graph.DataFloat(node.Data, "delayMs", 40)
	if delayMs < 0 {
		delayMs = 0
	}
	timer := time.NewTimer(time.Duration(delayMs) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func firstNonEmpty(values ...any) any {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			if typed != "" {
				return typed
			}
		case nil:
		default:
			return typed
		}
	}
	return ""
}

func ExampleGraph() *graph.GraphDocument {
	return &graph.GraphDocument{
		SchemaVersion: graph.CurrentSchemaVersion,
		ID:            "demo-flow",
		Name:          "FlowCanvas Backend SDK Demo",
		Viewport:      graph.ViewportState{Zoom: 1},
		Metadata:      map[string]any{"source": "flowcanvas-backend-sdk"},
		Nodes: []graph.Node{
			{ID: "text-1", Type: "prompt", Position: graph.Point{X: 80, Y: 80}, Data: graph.NodeData{"title": "故事", "prompt": "霓虹雨夜里的追逐故事"}},
			{ID: "image-1", Type: "image", Position: graph.Point{X: 420, Y: 80}, Data: graph.NodeData{"title": "画面", "prompt": "霓虹雨夜，电影感"}},
			{ID: "video-1", Type: "video", Position: graph.Point{X: 760, Y: 80}, Data: graph.NodeData{"title": "镜头", "prompt": "镜头推进", "duration": 5}},
		},
		Edges: []graph.Edge{
			{ID: "edge-text-image", Source: "text-1", SourcePort: "text", Target: "image-1", TargetPort: "prompt"},
			{ID: "edge-image-video", Source: "image-1", SourcePort: "image", Target: "video-1", TargetPort: "image"},
			{ID: "edge-text-video", Source: "text-1", SourcePort: "text", Target: "video-1", TargetPort: "prompt"},
		},
	}
}

func ProductionGraph() *graph.GraphDocument {
	return &graph.GraphDocument{
		SchemaVersion: graph.CurrentSchemaVersion,
		ID:            "production-flow",
		Name:          "FlowCanvas Backend SDK Production Chain",
		Viewport:      graph.ViewportState{Zoom: 1},
		Metadata:      map[string]any{"source": "flowcanvas-backend-sdk", "stage": "phase-2"},
		Nodes: []graph.Node{
			{ID: "text-1", Type: "prompt", Position: graph.Point{X: 80, Y: 80}, Data: graph.NodeData{"title": "故事文本", "prompt": "一个霓虹雨夜里，快递机器人穿过旧城区寻找失踪记忆芯片的短片。"}},
			{ID: "image-1", Type: "image", Position: graph.Point{X: 420, Y: 40}, Data: graph.NodeData{"title": "主视觉", "model": "全能图片 G2", "aspectRatio": "16:9", "resolution": "2K"}},
			{ID: "video-1", Type: "video", Position: graph.Point{X: 760, Y: 40}, Data: graph.NodeData{"title": "镜头生成", "model": "Vidu Q2", "duration": 5, "resolution": "1080p"}},
			{ID: "audio-1", Type: "audio", Position: graph.Point{X: 420, Y: 320}, Data: graph.NodeData{"title": "旁白音频", "model": "Mureka V9", "lyricsMode": "自动生成"}},
			{ID: "compose-1", Type: "compose", Position: graph.Point{X: 1100, Y: 160}, Data: graph.NodeData{"title": "成片合成", "resolution": "1080p", "format": "mp4"}},
		},
		Edges: []graph.Edge{
			{ID: "edge-text-image", Source: "text-1", SourcePort: "text", Target: "image-1", TargetPort: "prompt"},
			{ID: "edge-text-video", Source: "text-1", SourcePort: "text", Target: "video-1", TargetPort: "prompt"},
			{ID: "edge-image-video", Source: "image-1", SourcePort: "image", Target: "video-1", TargetPort: "image"},
			{ID: "edge-text-audio", Source: "text-1", SourcePort: "text", Target: "audio-1", TargetPort: "text"},
			{ID: "edge-video-compose", Source: "video-1", SourcePort: "video", Target: "compose-1", TargetPort: "video"},
			{ID: "edge-audio-compose", Source: "audio-1", SourcePort: "audio", Target: "compose-1", TargetPort: "audio"},
		},
	}
}

func BrokenGraph(kind string) *graph.GraphDocument {
	g := ExampleGraph()
	switch kind {
	case "cycle":
		g.Edges = append(g.Edges, graph.Edge{ID: "edge-cycle", Source: "video-1", SourcePort: "video", Target: "image-1", TargetPort: "reference"})
	case "missing-port":
		g.Edges[0].SourcePort = "missing"
	case "missing-prompt":
		g.Nodes[0].Data["prompt"] = ""
	default:
		panic(fmt.Sprintf("unknown broken graph kind %q", kind))
	}
	return g
}
