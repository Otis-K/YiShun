# Seedance 视频节点接入与真实验收

验收日期：2026-07-18（Asia/Shanghai）

## 实现范围

- 统一模型层新增标准化 `VideoRequest / VideoResult / VideoGenerator`。
- `seedance-2.0-mini / fast / pro` 注册为视频能力；Tool Plus 当前界面启用 `seedance-2.0-fast`。
- Go 后端提供有界任务队列、并发限制、5 秒任务轮询、30 分钟取消/超时边界、最大 512 MiB 下载和原子文件保存。
- 兼容平台文档与真实返回格式：`result_url`、`video_url`、`metadata/data/result/output` 嵌套 URL，以及 `/content` 下载回退。
- Electron 主进程另设共享模型队列（并发 1），API Key 使用 Windows `safeStorage` 加密，只通过子进程环境变量传递。
- 视频节点支持并原样透传：
  - `text2video / image2video / mixed2video`
  - `adaptive / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9`
  - `480p / 720p`
  - 4–15 秒
  - `enable_sound: on / off`
  - 首帧、尾帧、图片/音频 URL 和混合素材
- Seedance 要求参考素材必须是公网 HTTP/HTTPS URL；本地 blob 素材会在提交前明确阻止。上游生成节点会同时保留本地预览地址和公网结果地址，供下游首尾帧调用。

## 自动化验收

- Go 模型、Seedance 适配器、队列与 CLI 测试：通过。
- FlowCanvas SDK：12 个测试文件，103 项通过。
- Electron 节点桥：首帧→尾帧顺序、image2video、9:16、720p、15 秒、声音开启参数透传通过。
- Electron 画布回归：节点/连线、媒体嵌入、删除、撤销重做、取消、重启持久化与 1200 节点测试通过。

## 真实 API 验收：通过

真实链路：

`Tool Plus renderer -> Electron IPC -> Electron queue -> Go queue -> unified model layer -> Seedance task polling -> MP4 download -> video node playback`

- 模型：`seedance-2.0-fast`
- 模式：`text2video`
- 参数：`16:9 / 480p / 4 秒 / sound off`
- 平台任务：成功
- 本地文件：1,681,336 字节，MP4 `ftypisom`
- FFmpeg 完整解码：H.264 High，864×496，24 fps，97 帧，4.04 秒，无解码错误
- 真实生成文件在视频节点中加载元数据并可使用自定义播放控件播放：通过
- 报告：`work/real-video-acceptance.json`（不含 API Key）
