# Tool Plus 0.5.19 Seedance Pro(431) 适配验收

日期：2026-07-18

## 实现

- 新增模型 `seedance-2.0-pro(431)`，默认视频模型切换为该模型。
- 使用专用请求字段：`first_image`、`last_image`、`referenceImages`、`referenceVideos`、`referenceAudios`。
- 不向 Pro(431) 泄漏旧协议的 `mode_type`、`enable_sound`、`image_urls`、`audio_urls`、`mixed_list`。
- 强制 720p；比例限制为 16:9、9:16、1:1；时长限制 4–15 秒。
- 首尾帧必须成对且不能与参考素材混用；参考限制为 4 图、3 视频、1 音频。
- 查询轮询最短间隔 30 秒；继续支持平台实时状态和失败原因同步到节点。

## 验收

- FlowCanvas SDK：12 文件、108 项测试 PASS。
- Go Backend SDK：全包测试 PASS，含 Pro(431) 专用请求结构断言。
- Tool Plus 原生 Electron：完整 PASS，含模型桥接、并行、重启持久化、1200 节点压力。

## 真实平台结果

改用绑定 `seedance` 分组的视频密钥后，真实链路 PASS：

- 模型：`seedance-2.0-pro(431)`
- 参数：720p、16:9、4 秒、文生视频
- task ID：`task_fxhLU2gkgiePzZXTJUQs3zHKVH68QKnc`
- 最终状态：`completed`，进度 100%
- 端到端耗时：约 6 分 15 秒
- 下载结果：MP4，2,862,103 bytes
- 本地保存：`G:\tool-plus-data\canvas-assets\videos\task_fxhLU2gkgiePzZXTJUQs3zHKVH68QKnc-1784389171976.mp4`

原始响应见 `real-video-pro431-acceptance-0.5.19.json`，交付样片见 `seedance-pro431-real-acceptance-0.5.19.mp4`。
