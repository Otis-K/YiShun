# Tool Plus 0.5.6 OSS 视频素材复验

日期：2026-07-18

## 本轮复验结论

- Electron 画布首帧、尾帧、参考音频、参考视频四项本地素材桥接 PASS；四项字节均非空，角色和顺序保持正确。
- `firstFrame + lastFrame` 正确映射为 `image2video` 的两个有序 `image_urls`。
- `reference video + reference audio` 正确映射为 `mixed2video` 的 `mixed_list`，类型分别为 `video / audio`。
- Electron 隔离暂存、路径越界拒绝和任务结束清理 PASS。
- 图片、音频、视频真实 OSS 上传、临时签名下载和 SHA-256 往返一致性继续 PASS。
- FlowCanvas Electron 回归与 1200 节点压力测试 PASS。
- Go Backend SDK 全量 `go test -timeout 120s ./...` PASS。

## 真实模型复验

| 场景 | 模型 | 任务 | 结果 |
| --- | --- | --- | --- |
| 首帧＋尾帧 | `seedance-2.0-fast` | `task_OP5OFMD7drq5g0B6PZuDL73lBSFXpoBI` | 平台创建成功，约 32 秒后 `failed` |
| 参考视频＋参考音频 | `seedance-2.0-fast` | `task_xcPpCBudISrRNxZK2WcP0AqnbZjxfS5j` | 平台创建成功，约 9 秒后 `failed` |
| 首帧＋尾帧对照 | `seedance-2.0-mini` | `task_sjB1zAQMohdEaqpfBR6sockYwFMXowre` | 平台创建成功，约 32 秒后 `failed` |

三个任务均可通过 API Key 查询，HTTP 状态为 200，但查询接口没有返回 `failure_reason`。结合平台任务详情显示的“算力不足”，可判定当前 Seedance 上游算力池不可用；mini 对照同样失败，排除了 fast 单型号和首尾帧/混合素材参数问题。

本验收不把平台失败冒充为视频生成成功。

## 0.5.6 修正

Go 统一模型层现在会从顶层及嵌套 `error / data / metadata / result / output` 中归一化失败原因。若平台查询接口仍返回空原因，节点会明确显示“模型平台返回失败，但查询接口未提供失败原因”，不再出现冒号后空白的错误。

## 交付哈希

- 安装器 SHA-256：`BE2515253113AF48EF18921F92087B0100D658F9A81D71EA2EC6586318BF325B`
- 解包应用 SHA-256：`084F88FFF8A246732697B14D372564A21558B35C161354C7C0E3E77DFFEA2748`
- FlowCanvas Go 后端 SHA-256：`79C1382C8A524330161E1858FAD38011CCC68DD9DF1BD0F45169EA20125FBD43`
