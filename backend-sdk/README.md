# FlowCanvas Backend SDK for Go

这是 FlowCanvas 前端 SDK 的独立后端配套 SDK，不依赖 Tool Plus 工具模块。

它负责：

- 解析前端 SDK 导出的 `GraphDocument` JSON；
- 注册节点类型、端口和执行器；
- 校验节点、边、端口、必填输入、端口类型、DAG 环路；
- 按拓扑顺序执行图；
- 输出节点状态、进度、日志和结果事件；
- 支持取消运行；
- 提供可选 HTTP + SSE 服务层，方便前端 SDK 直接接入；
- 提供 OpenAI-compatible 模型执行器，默认中转地址为 `https://api.tmlab.store`；
- 提供 SQLite 运行记录、事件和结果持久化；
- 提供文件资产存储，用于保存图片/视频/音频/合成等结构化生成结果。
- 提供阿里云 OSS 服务端上传和临时签名 URL；Electron/Web 前端无需接触 OSS AccessKey。

## 目录

```text
FlowCanvas-Backend-SDK
├─ graph          GraphDocument / Node / Edge 数据模型和 JSON import/export
├─ schema         节点类型、端口定义和注册表
├─ builtin        prompt / image / video / audio / compose 内置节点和 demo executor
├─ validator      图校验、端口校验、DAG 校验
├─ topology       拓扑排序和环路判断
├─ runtime        RunGraph、RunNode、事件日志、取消、重试
├─ events         运行事件结构
├─ ai             OpenAI-compatible HTTP client
├─ asset          文件资产存储
├─ executors/ai   真实模型执行器
├─ storage/sqlite SQLite run/event/result 持久化
├─ storage/aliyunoss 本地图片/视频/音频上传、类型/大小校验和临时签名
├─ transport      HTTP / SSE 服务适配
├─ examples       example server 和前端接入示例
└─ cmd            acceptance / realchain 验收入口
```

## 本地素材上传与 Seedance

`cmd/toolplus` 支持 `image.generate` 和 `video.generate` 的 `localAssets`。Go 后端优先读取 `%APPDATA%\tool-plus\flowcanvas-oss.json`：

```json
{
  "endpoint": "https://oss-cn-shenzhen.aliyuncs.com",
  "accessKeyId": "你的 AccessKey ID",
  "accessKeySecret": "你的 AccessKey Secret",
  "bucket": "你的私有 Bucket",
  "prefix": "mm-agent/tool-plus",
  "signedUrlTtlSeconds": 7200
}
```

缺少配置文件或单个字段时，兼容读取下列环境变量：

```powershell
$env:FLOWCANVAS_OSS_ENDPOINT="oss-cn-shenzhen.aliyuncs.com"
$env:FLOWCANVAS_OSS_ACCESS_KEY_ID="由部署环境注入"
$env:FLOWCANVAS_OSS_ACCESS_KEY_SECRET="由部署环境注入"
$env:FLOWCANVAS_OSS_BUCKET="你的私有 Bucket"
$env:FLOWCANVAS_OSS_PREFIX="mm-agent/tool-plus"
$env:FLOWCANVAS_OSS_SIGNED_URL_TTL_SECONDS="7200"
```

`image2video` 会按顺序把首帧、尾帧和其它参考图写入 `image_urls`，参考音频写入 `audio_urls`；存在参考视频时使用 `mixed2video`，把图片、视频和音频写入 `mixed_list`。对象使用独立前缀和随机键，签名 URL 默认两小时有效。

## 快速运行

本机当前可用 Go：

```powershell
G:\DevEnv\go_1_24_13\bin\go.exe version
```

单元测试：

```powershell
G:\DevEnv\go_1_24_13\bin\go.exe test ./...
```

功能验收：

```powershell
G:\DevEnv\go_1_24_13\bin\go.exe run ./cmd/acceptance
```

启动 example server：

```powershell
G:\DevEnv\go_1_24_13\bin\go.exe run ./examples/server -addr 127.0.0.1:8787
```

启动真实 AI executor 模式：

```powershell
$env:TMLAB_API_KEY="你的 tmlab key"
$env:FLOWCANVAS_AI_BASE_URL="https://api.tmlab.store"
$env:FLOWCANVAS_AI_MODEL="gpt-4o-mini"
G:\DevEnv\go_1_24_13\bin\go.exe run ./examples/server -mode ai -addr 127.0.0.1:8787
```

直接跑真实链路验收：

```powershell
$env:TMLAB_API_KEY="你的 tmlab key"
$env:FLOWCANVAS_AI_BASE_URL="https://api.tmlab.store"
$env:FLOWCANVAS_AI_MODEL="seedance-2.0-fast"
G:\DevEnv\go_1_24_13\bin\go.exe run ./cmd/realchain
```

`cmd/realchain` 会执行完整链路：

```text
文本生成 → 图片生成规划 → 视频生成规划
       └→ 音频生成规划 → 视频+音频合成清单
```

当前实现使用真实模型调用生成结构化资产；图片/视频/音频媒体文件生成服务可作为后续 provider 插件替换，不需要改 graph/schema/runtime。

## HTTP 接口

```text
GET  /api/flow/health
POST /api/flow/validate
POST /api/flow/run
POST /api/flow/run-node
POST /api/flow/cancel
GET  /api/flow/runs
GET  /api/flow/runs/{runId}
GET  /api/flow/runs/{runId}/events
```

`/events` 使用 SSE，事件类型示例：

```text
run.started
node.queued
node.running
node.progress
node.succeeded
node.failed
node.cancelled
run.completed
run.failed
run.cancelled
```

## Go SDK 用法

```go
engine := builtin.NewDemoEngine()
doc := builtin.ExampleGraph()

result := validator.Validate(doc, engine.Registry())
if !result.Valid {
    // 返回给前端显示
}

run, err := engine.RunGraph(context.Background(), doc, runtime.RunOptions{
    StopOnError: true,
})
```

接入 tmlab / OpenAI-compatible 模型执行器：

```go
store, _ := sqlite.Open("data/flowcanvas.db")
assets, _ := asset.NewFileStore("data/assets", "")
client, _ := ai.NewOpenAIClient(ai.ConfigFromEnv())

engine := runtime.NewEngine(builtin.Registry(), runtime.WithRunObserver(store))
_ = aiexec.RegisterExecutors(engine, aiexec.Config{
    Client: client,
    AssetStore: assets,
})

result, err := engine.RunGraph(context.Background(), builtin.ProductionGraph(), runtime.RunOptions{
    StopOnError: true,
    MaxRetries: 1,
})
```

订阅事件：

```go
handle, _ := engine.Run(context.Background(), doc, runtime.RunOptions{StopOnError: true})
events, unsubscribe := handle.Subscribe(true)
defer unsubscribe()

for event := range events {
    // 推给前端
}
```

## 前端 SDK 接入

参考：

```text
examples/frontend/remote-runtime-example.ts
```

前端导出 graph：

```ts
const graph = canvas.export()
const runtime = new FlowCanvasGoRuntime('http://127.0.0.1:8787/api/flow')
await runtime.validate(graph)
await runtime.run(graph, event => {
  // 更新节点 running / progress / succeeded / failed / cancelled
})
```

## 当前阶段边界

第一阶段的确定性 demo executor 仍保留，适合无模型密钥时做开发和回归：

- `prompt` 返回文本；
- `image` 返回 demo image 对象；
- `video` 返回 demo video 对象；
- `audio` 返回 demo audio 对象；
- `compose` 返回 demo output video 对象。

第二阶段已实现真实模型 executor、SQLite 持久化、资产存储和 HTTP 历史记录查询。

注意：`https://api.tmlab.store` 通常会要求 API key 和可用额度。没有 `TMLAB_API_KEY` / `FLOWCANVAS_AI_API_KEY` / `OPENAI_API_KEY`，或账号额度不足时，`cmd/realchain` 会真实请求并返回服务端错误，不会伪造成功。真实链路默认不重试；如需重试可设置 `FLOWCANVAS_RUN_MAX_RETRIES`。
