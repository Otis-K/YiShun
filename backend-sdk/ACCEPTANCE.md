# FlowCanvas Backend SDK 验收记录

日期：2026-07-17  
模块：`G:\FlowCanvas-SDK\FlowCanvas-Backend-SDK`  
Go 工具链：`go1.24.13 windows/amd64`

## 第一阶段范围

已实现：

- Go graph 数据模型；
- JSON import/export；
- 节点、边、端口校验；
- DAG 拓扑排序和环路判断；
- `prompt / image / video / audio / compose` 五类内置节点定义；
- demo executor；
- RunGraph 执行；
- RunNode 执行；
- Cancel 支持；
- SSE 事件流；
- example server；
- 前端 SDK 对接示例；
- 单元测试；
- 独立功能验收程序。

## 第二阶段范围

已实现：

- OpenAI-compatible 模型 HTTP client；
- 默认模型中转 Base URL：`https://api.tmlab.store`；
- `FLOWCANVAS_AI_BASE_URL / FLOWCANVAS_AI_MODEL / FLOWCANVAS_AI_API_KEY / TMLAB_API_KEY / TMLAB_BASE_URL / TMLAB_MODEL / OPENAI_API_KEY` 环境变量配置；
- `prompt / image / video / audio / compose` 五类真实 AI executor；
- 完整生产链路图：文本 → 图片 → 视频、文本 → 音频、视频+音频 → 合成；
- 文件资产存储，保存图片规划、视频规划、音频规划、合成清单等结构化结果；
- SQLite run / event / result / graph 持久化；
- HTTP run archive：`GET /api/flow/runs`、历史 `GET /api/flow/runs/{runId}`、历史 SSE replay；
- example server 支持 `-mode demo` 与 `-mode ai`；
- `cmd/realchain` 真实 tmlab 链路入口；
- 第二阶段单元测试和本地 OpenAI-compatible 协议验收。

## 已执行命令

```powershell
G:\DevEnv\go_1_24_13\bin\go.exe test ./...
G:\DevEnv\go_1_24_13\bin\go.exe run ./cmd/acceptance
G:\DevEnv\go_1_24_13\bin\go.exe run ./cmd/realchain
```

## 单元测试结果

`go test ./...`：PASS

覆盖：

- 前端 graph JSON 解析和 marshal；
- 默认值 normalize；
- 拓扑排序；
- cycle 判断；
- 正常图校验；
- 错误端口、环路、缺参数、缺必填输入；
- RunGraph 文本 → 图片 → 视频；
- RunNode；
- Cancel；
- HTTP validate/run；
- SSE run.completed 事件；
- OpenAI-compatible chat/completions client；
- AI executor 完整生产链路；
- 文件资产落盘；
- SQLite run/event/result 持久化；
- HTTP archive run 列表查询。

## 功能验收结果

`go run ./cmd/acceptance`：PASS

验收输出摘要：

```json
{
  "ok": true,
  "checks": [
    "valid graph parses and validates",
    "invalid graph reports missing-port",
    "invalid graph reports cycle",
    "invalid graph reports missing-prompt",
    "runtime text -> image -> video",
    "runtime cancel",
    "HTTP run starts",
    "SSE emits progress and completed",
    "phase-2 AI executor + SQLite + assets + HTTP archive"
  ]
}
```

## 真实 tmlab 外呼结果

已执行：

```powershell
G:\DevEnv\go_1_24_13\bin\go.exe run ./cmd/realchain
```

结果：已连通 `https://api.tmlab.store` 并通过 API Key 鉴权；真实完整链路未能完成，原因不是 SDK 执行链路错误，而是当前账号额度为 0。

已查询 `/v1/models`，当前账号可见模型包括：

```text
seedance-2.0-fast
seedance-2.0-pro-720p
seedance-2.0-mini
seedance-2.0-pro
```

使用 `seedance-2.0-fast` 跑 `cmd/realchain` 的真实返回：

```json
{
  "baseURL": "https://api.tmlab.store",
  "model": "seedance-2.0-fast",
  "status": "failed",
  "error": "AI provider returned HTTP 403: {\"error\":{\"message\":\"用户额度不足, 剩余额度: ¥0.000000\",\"type\":\"new_api_error\",\"code\":\"insufficient_user_quota\"}}"
}
```

要完成 tmlab 真模型验收，请先确保账号有可用额度，并设置其中一个环境变量：

```powershell
$env:TMLAB_API_KEY="你的 tmlab key"
# 或
$env:FLOWCANVAS_AI_API_KEY="你的 tmlab key"
# 或
$env:OPENAI_API_KEY="你的 tmlab key"
```

然后重新执行：

```powershell
G:\DevEnv\go_1_24_13\bin\go.exe run ./cmd/realchain
```

真实链路默认不重试，避免额度接口失败时重复消耗；如需重试可显式设置：

```powershell
$env:FLOWCANVAS_RUN_MAX_RETRIES="1"
```

## 与 Tool Plus 的关系

本模块不依赖 Tool Plus，也不调用 Tool Plus 工具后端。

Tool Plus 未来可以作为一个接入方，把前端 SDK 导出的 graph 发给此 Go 后端 SDK；其它 Electron/Web 项目也可以用同样方式接入。

## 2026-07-18 本地素材与 Seedance 增量验收

已新增并验收：

- 阿里云 OSS 服务端上传、MIME/大小校验、随机对象键和临时签名 GET URL；
- Electron 隔离暂存、目录越界拒绝、结束清理；
- 首帧、尾帧、参考图片、参考视频和参考音频参数映射；
- `image2video / mixed2video` 自动选择；
- Seedance 队列、五秒轮询、失败回传和成功媒体下载；
- 图片、音频、视频三个真实 OSS 上传与签名下载 SHA-256 往返一致。

`go test -timeout 120s ./...`、Electron 本地素材桥接和 1200 节点压力回归均为 PASS。真实模型侧连续三次返回 `failed`（两次 `image2video`、一次 `text2video`），任务查询 HTTP 200 但 `failure_reason` 为空。因此可以确认任务创建和轮询真实连通，同时也确认本轮 Seedance 渠道失败与 OSS 素材无关；本记录不把外部平台失败冒充为生成成功。

## 前端 SDK 真实接入验收

已在 `G:\FlowCanvas-SDK\FlowCanvas-SDK` 中实现 `GoBackendWorkflowRuntime` 并执行：

```powershell
pnpm test:go-backend
```

结果：PASS

覆盖：

- 启动真实 Go example server；
- `CanvasEngine` 注入 `GoBackendWorkflowRuntime`；
- 前端 graph 调用 Go `/validate`；
- 前端 graph 调用 Go `/run`；
- 前端读取 Go `/events` SSE；
- Go 节点事件映射为前端 `run:node` 状态；
- 最终 outputs 从 Go `/runs/{runId}` 回读；
- 前端 `cancel()` 触发 Go `/cancel` 并返回 `cancelled`。
