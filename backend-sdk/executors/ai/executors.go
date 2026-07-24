package aiexec

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/flowcanvas/flowcanvas-backend-sdk/ai"
	"github.com/flowcanvas/flowcanvas-backend-sdk/asset"
	"github.com/flowcanvas/flowcanvas-backend-sdk/graph"
	"github.com/flowcanvas/flowcanvas-backend-sdk/runtime"
)

type JSONGenerator interface {
	GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (map[string]any, string, error)
}

type Config struct {
	Client     JSONGenerator
	AssetStore *asset.FileStore
}

func NewConfigFromEnv(assetDir string) (Config, error) {
	client, err := ai.NewOpenAIClient(ai.ConfigFromEnv())
	if err != nil {
		return Config{}, err
	}
	store, err := asset.NewFileStore(assetDir, "")
	if err != nil {
		return Config{}, err
	}
	return Config{Client: client, AssetStore: store}, nil
}

func RegisterExecutors(engine *runtime.Engine, config Config) error {
	if engine == nil {
		return errors.New("runtime engine is nil")
	}
	if config.Client == nil {
		return errors.New("AI JSON generator is required")
	}
	if config.AssetStore == nil {
		return errors.New("asset store is required")
	}
	executors := &executors{client: config.Client, assets: config.AssetStore}
	engine.RegisterExecutor("prompt", runtime.ExecutorFunc(executors.prompt))
	engine.RegisterExecutor("image", runtime.ExecutorFunc(executors.image))
	engine.RegisterExecutor("video", runtime.ExecutorFunc(executors.video))
	engine.RegisterExecutor("audio", runtime.ExecutorFunc(executors.audio))
	engine.RegisterExecutor("compose", runtime.ExecutorFunc(executors.compose))
	return nil
}

type executors struct {
	client JSONGenerator
	assets *asset.FileStore
}

func (e *executors) prompt(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	prompt := stringValue(input.Node.Data["prompt"])
	if prompt == "" {
		prompt = stringValue(input.Inputs["text"])
	}
	emit(0.15, "准备文本生成请求")
	payload, raw, err := e.generate(ctx, "文本生成节点", map[string]any{
		"task":          "把用户输入扩展为可供多模态生成工作流使用的简洁创作提示词。",
		"input":         prompt,
		"requiredShape": map[string]any{"text": "string", "title": "string", "styleTags": []string{"string"}},
	})
	if err != nil {
		return nil, err
	}
	emit(0.85, "文本生成完成")
	text := stringValue(payload["text"])
	if text == "" {
		text = prompt
	}
	return map[string]any{
		"text": text,
		"meta": map[string]any{
			"title":     payload["title"],
			"styleTags": payload["styleTags"],
			"raw":       raw,
		},
	}, nil
}

func (e *executors) image(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	prompt := firstText(input.Inputs["prompt"], input.Node.Data["prompt"])
	emit(0.15, "请求图片生成规划")
	payload, raw, err := e.generate(ctx, "图片生成节点", map[string]any{
		"task":       "根据提示词输出图片生成规划。不要真实下载图片，返回稳定结构化结果，方便下游真实图片服务替换。",
		"prompt":     prompt,
		"references": input.Inputs["reference"],
		"parameters": compactNodeData(input.Node.Data),
		"requiredShape": map[string]any{
			"prompt":       "string",
			"negative":     "string",
			"aspectRatio":  "string",
			"resolution":   "string",
			"visualStyle":  "string",
			"shot":         "string",
			"seedHint":     "string",
			"qualityNotes": []string{"string"},
		},
	})
	if err != nil {
		return nil, err
	}
	asset, err := e.save(ctx, "image", input, "image-spec.json", payload, raw)
	if err != nil {
		return nil, err
	}
	emit(1, "图片规划资产已保存")
	return map[string]any{"image": asset.Map()}, nil
}

func (e *executors) video(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	prompt := firstText(input.Inputs["prompt"], input.Node.Data["prompt"])
	emit(0.12, "请求视频生成规划")
	payload, raw, err := e.generate(ctx, "视频生成节点", map[string]any{
		"task":       "根据提示词和首尾帧资产输出视频生成规划。不要真实合成视频，返回可被真实视频服务消费的结构化结果。",
		"prompt":     prompt,
		"firstFrame": input.Inputs["image"],
		"lastFrame":  firstAny(input.Inputs["lastFrame"], input.Node.Data["lastFrame"]),
		"parameters": compactNodeData(input.Node.Data),
		"requiredShape": map[string]any{
			"prompt":       "string",
			"motion":       "string",
			"camera":       "string",
			"durationSec":  "number",
			"resolution":   "string",
			"fps":          "number",
			"timeline":     []map[string]string{{"time": "string", "action": "string"}},
			"safetyChecks": []string{"string"},
		},
	})
	if err != nil {
		return nil, err
	}
	asset, err := e.save(ctx, "video", input, "video-plan.json", payload, raw)
	if err != nil {
		return nil, err
	}
	emit(1, "视频规划资产已保存")
	return map[string]any{"video": asset.Map()}, nil
}

func (e *executors) audio(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	text := firstText(input.Inputs["text"], input.Node.Data["prompt"])
	emit(0.18, "请求音频生成规划")
	payload, raw, err := e.generate(ctx, "音频生成节点", map[string]any{
		"task":       "根据文本输出音乐、旁白或角色语音的生成规划。返回结构化音频资产描述。",
		"text":       text,
		"parameters": compactNodeData(input.Node.Data),
		"requiredShape": map[string]any{
			"audioType":   "string",
			"voice":       "string",
			"mood":        "string",
			"tempo":       "string",
			"lyrics":      "string",
			"durationSec": "number",
		},
	})
	if err != nil {
		return nil, err
	}
	asset, err := e.save(ctx, "audio", input, "audio-plan.json", payload, raw)
	if err != nil {
		return nil, err
	}
	emit(1, "音频规划资产已保存")
	return map[string]any{"audio": asset.Map()}, nil
}

func (e *executors) compose(ctx context.Context, input runtime.NodeInput, emit runtime.ProgressFunc) (map[string]any, error) {
	emit(0.2, "请求合成清单")
	payload, raw, err := e.generate(ctx, "镜头合成节点", map[string]any{
		"task":       "把视频资产、音频资产和节点参数合成为可执行的成片导出清单。",
		"video":      input.Inputs["video"],
		"audio":      input.Inputs["audio"],
		"parameters": compactNodeData(input.Node.Data),
		"requiredShape": map[string]any{
			"title":       "string",
			"tracks":      []map[string]string{{"type": "string", "assetId": "string", "placement": "string"}},
			"subtitles":   []map[string]string{{"time": "string", "text": "string"}},
			"export":      map[string]string{"format": "string", "resolution": "string"},
			"reviewNotes": []string{"string"},
		},
	})
	if err != nil {
		return nil, err
	}
	asset, err := e.save(ctx, "compose", input, "composition-manifest.json", payload, raw)
	if err != nil {
		return nil, err
	}
	emit(1, "合成清单已保存")
	return map[string]any{"output": asset.Map()}, nil
}

func (e *executors) generate(ctx context.Context, role string, payload map[string]any) (map[string]any, string, error) {
	user, _ := json.MarshalIndent(payload, "", "  ")
	return e.client.GenerateJSON(ctx, systemPrompt(role), string(user))
}

func (e *executors) save(ctx context.Context, kind string, input runtime.NodeInput, filename string, payload map[string]any, raw string) (*asset.Asset, error) {
	document := map[string]any{
		"nodeId":     input.Node.ID,
		"nodeType":   input.Node.Type,
		"runId":      input.RunID,
		"attempt":    input.Attempt,
		"payload":    payload,
		"rawContent": raw,
	}
	name := strings.TrimSpace(graph.DataString(input.Node.Data, "title"))
	if name == "" {
		name = input.Node.ID
	}
	name = name + "-" + filename
	return e.assets.SaveJSON(ctx, kind, filepath.Base(name), document, map[string]any{
		"nodeId":   input.Node.ID,
		"nodeType": input.Node.Type,
		"runId":    input.RunID,
	})
}

func systemPrompt(role string) string {
	return fmt.Sprintf(`你是 FlowCanvas 后端 SDK 的%s执行器。
你只返回一个 JSON object，不要 Markdown，不要解释。
字段值必须具体、可供下游程序消费；如果上游输入是资产对象，请保留其中的 id/path/sha256 等引用。
输出语言优先中文，技术字段保持稳定英文 key。`, role)
}

func compactNodeData(data graph.NodeData) map[string]any {
	out := map[string]any{}
	for k, v := range data {
		if strings.HasPrefix(k, "_") {
			continue
		}
		out[k] = v
	}
	return out
}

func firstText(values ...any) string {
	for _, value := range values {
		text := stringValue(value)
		if text != "" {
			return text
		}
	}
	return ""
}

func firstAny(values ...any) any {
	for _, value := range values {
		if value != nil {
			if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
				continue
			}
			return value
		}
	}
	return nil
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		if typed == nil {
			return ""
		}
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}
