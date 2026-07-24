# 图片生成节点接入与验收记录

更新时间：2026-07-18（Asia/Shanghai）  
版本：Tool Plus 0.5.8

当前结论：图片节点前后端闭环与真实 NanoBanana API 验收均已通过。

已实现：

- 图片/视频独立模型 profile 和独立加密密钥。
- Electron iframe 窄消息桥、Go 统一模型层、队列和任务轮询。
- 1K/2K/4K、11 种画幅、提示词与扩展参数透传。
- 远程及本地参考图；本地素材通过 Go 服务端 OSS 上传和短期签名。
- 多参考图原始顺序保持、结果下载、图片解码和原节点回填。
- API 地址变化时强制重新输入密钥，读取 IPC 和报告不暴露凭据。

真实 API 结果：

- 2K、16:9 文生图：`completed`，2752 × 1536 PNG，6,704,241 字节。
- 1K、1:1 本地参考图生图：`completed`，1024 × 1024 PNG，1,619,771 字节，OSS 上传证据 1 条。

详细参数、任务证据、自动化覆盖、发布哈希和未扩大声明见 [docs/ACCEPTANCE_IMAGE_MODEL_0.5.7.md](docs/ACCEPTANCE_IMAGE_MODEL_0.5.7.md)。机器可读脱敏报告为 `work/real-image-acceptance.json`。
