# Tool Plus 0.5.5 OSS 视频素材验收

日期：2026-07-18

## 已通过

- Electron 画布只读取用户选择的 `blob:` / `data:` 本地内容，不允许 HTTP/HTTPS 外呼，也不保存 OSS AccessKey。
- Electron 主进程把素材写入用户目录隔离暂存区；支持图片 25 MiB、音频 50 MiB、视频 500 MiB，最多 15 项；越界路径被拒绝，任务结束自动清理。
- Go 后端使用阿里云官方 OSS SDK上传，复用 mm-agent Bucket，使用 `mm-agent/tool-plus/` 独立前缀和随机对象键，生成默认两小时有效的签名 GET URL。
- 图片、音频、视频均完成真实 OSS 上传、签名下载和 SHA-256 往返一致性验证。
- 视频节点支持首帧、尾帧、参考图片、参考视频、参考音频；自动映射 `image2video / mixed2video`、`image_urls / audio_urls / mixed_list`。
- Seedance 请求保留用户选择的模型、比例、分辨率、4–15 秒时长、声音开关和额外参数；队列并发为 1，五秒轮询，失败真实回传，成功后下载到本地节点播放。
- FlowCanvas SDK：TypeScript 检查 PASS，103 个单元测试 PASS，浏览器产物构建 PASS。
- Go Backend SDK：`go test -timeout 120s ./...` PASS。
- Tool Plus：114 工具基础回归、真实两步任务流、同窗口沉浸式画布、本地素材桥接、视频播放、取消、持久化和 1200 节点压力回归 PASS。
- 打包后静态/资源/CSP 验收 PASS；部署 EXE 启动后保持 4 个生产进程，启动存活检查 PASS。

## 真实模型渠道状态

本轮真实提交了两个 `image2video` 和一个对照 `text2video`。三个 `seedance-2.0-fast` 任务均成功创建并可用鉴权查询，但平台随后返回 `failed`，HTTP 查询为 200 且 `failure_reason` 为空。纯文生视频同样失败，故该结果与 OSS 首帧无关，属于当前模型渠道或账号侧状态。

本验收不把上述外部失败记为“生成成功”。待渠道恢复后，无需修改客户端即可重跑真实生成。

## 运行配置边界

OSS 凭据不进入安装包。运行 Tool Plus 的部署环境需要只向本地 Go 后端进程提供：

- `FLOWCANVAS_OSS_ENDPOINT`
- `FLOWCANVAS_OSS_ACCESS_KEY_ID`
- `FLOWCANVAS_OSS_ACCESS_KEY_SECRET`
- `FLOWCANVAS_OSS_BUCKET`
- `FLOWCANVAS_OSS_PREFIX`
- `FLOWCANVAS_OSS_SIGNED_URL_TTL_SECONDS`

生产分发时应由受控部署环境、服务管理器或凭据系统注入，不应把永久 AccessKey 写入前端代码、画布数据、安装包或普通配置文件。

## 交付哈希

- 安装器 SHA-256：`5FCA631DC2997370DD96C198B7FF3D9902CF7EEBA82888BF264BB624892B4F10`
- 解包应用 SHA-256：`83B7546B7EE5B304F0D59255998A96AA9248762C967FEDBEEB975FFB89F187D4`
- FlowCanvas Go 后端 SHA-256：`084B0F42013F62009162115EE1FA0FD5C461AB9FD872F1A4E099D4600D06090B`
