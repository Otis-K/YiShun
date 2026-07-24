# Tool Plus 0.5.20 Seedance 视频三模式真实验收

日期：2026-07-18

模型：`seedance-2.0-pro(431)`；分组：`seedance`；参数：720p、16:9、4 秒。

## 协议映射

- 单图图生视频：单张图片映射到 `referenceImages`。真实上游不接受单独 `first_image`。
- 首尾帧：成对映射到 `first_image` 和 `last_image`，并禁止混入参考素材。
- 参考生视频：分别映射 `referenceImages`、`referenceVideos`、`referenceAudios`，限制为 4 图、3 视频、1 音频。
- UI 只提供模型支持的 720p、16:9/9:16/1:1、4–15 秒，不展示声音开关。

## 自动化

- FlowCanvas SDK：108/108 PASS。
- Go Backend SDK：全包 PASS，包含 Pro(431) 字段、互斥和数量限制测试。
- Tool Plus 原生 Electron：PASS，包含并行、进度、节点恢复、素材桥接和 1200 节点压力。

## 真实平台结果

| 场景 | Task ID | 结果 | 耗时 | 视频大小 |
|---|---|---|---:|---:|
| 单图图生视频 | `task_cfDvbybWRyveywP3iSyGWYeOdGXICPH8` | completed | 218 秒 | 3,359,307 bytes |
| 首尾帧 | `task_6m1TIeUT5FRKUu2MoVcPHC5OIKNlQ7Po` | completed | 361 秒 | 2,637,042 bytes |
| 图片+视频+音频参考 | `task_vUCrSiJKce9BHYfo5aZVzsOJBuVzf8nO` | completed | 264 秒 | 2,746,185 bytes |

三项均完成本地素材上传 OSS、平台创建、轮询、下载并保存为本地 MP4。
