# Tool Plus 0.5.7 图片模型配置与生图验收

日期：2026-07-18

## 实现范围

- 图片和视频使用两个独立模型配置：各自保存 API 地址、模型名和加密密钥。
- API Key 使用 Electron `safeStorage` 加密后写入当前 Windows 用户设置；前端 IPC、画布 JSON、localStorage、验收报告和安装包均不包含密钥。
- 修改已配置模型的 API 地址时必须重新输入对应 API Key，避免旧密钥被静默发送到新地址。
- 旧版单模型配置只按模型能力迁移到图片或视频其中一项，不再同时复用到两种能力。
- 图片节点模型为 `nano-banana-pro(特价版 1)`，支持提示词、1K/2K/4K、`auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9` 和多张参考图。
- 远程参考图直接传给模型；本地参考图由 Electron 隔离暂存，再由 Go 后端上传 OSS 并生成短期签名地址。混用本地和远程参考图时保留用户原始顺序。
- 模型层保留未冲突的扩展参数，不用默认值覆盖用户明确设置；当前 API 每次只生成 1 张，因此界面数量固定为 1。
- 完成任务后，Go 后端下载图片到用户目录，Electron 以本地文件地址回填原图片节点。

## 自动化验收

- FlowCanvas Backend SDK：`go test -timeout 120s ./...`，通过；包含模型能力隔离、NanoBanana 参数透传、3 种尺寸 × 11 种比例矩阵、非法尺寸/比例和混合参考图顺序测试。
- Tool Plus 模型配置：`npm run verify:model-profiles`，通过；确认图片/视频密文不同、明文不落盘、空 Key 保留原配置、修改 API 地址必须重输 Key、读取 IPC 脱敏。
- Tool Plus 画布桥接：`npm run verify:toolplus-native-canvas`，通过；确认提示词、4K、3:2、远程与本地参考图、原始顺序和非空素材字节进入宿主请求。
- 画布简单压力：同一验收运行 1,200 节点图，耗时约 2 秒并通过。

## 真实 API 验收

命令：`npm run verify:real-image`（运行时注入 OSS 服务端环境变量，模型密钥从 Windows 加密设置读取）。

结果：通过，证据文件为 `work/real-image-acceptance.json`，且报告经过密钥、Authorization 和 HTTP/HTTPS 地址扫描。

| 用例 | 实际参数 | 平台状态 | 下载与解码 | 证据 |
| --- | --- | --- | --- | --- |
| 文生图 | 2K、16:9、0 张参考图 | `completed` | 6,704,241 字节；2752 × 1536 PNG | 任务 `task_QXtUE6oFVU7AgkKonPGeq7eDuSheTYLW` |
| 本地参考图生图 | 1K、1:1、1 张本地参考图 | `completed` | 1,619,771 字节；1024 × 1024 PNG | 任务 `task_LLGrYaSwokmeNSNFMN9RiavcWDVq9zWo`；OSS 上传证据 1 条 |

两个结果均满足：响应字节数与落盘文件一致、Electron `nativeImage` 可解码、宽高大于 0、provider/model/任务状态及请求回显符合预期。这里没有把“任务已提交”或“HTTP 200”当成生成成功。

## 未扩大声明

- 本轮只真实计费验证 2K/16:9 与 1K/1:1 两个代表用例；其余尺寸/比例由请求矩阵单元测试覆盖，没有声称逐一真实计费生成。
- 音频生成节点仍是本地运行时，不属于本轮图片节点交付范围。
- 代码签名不在本轮范围，安装包仍可能触发 Windows SmartScreen。

## 0.5.7 打包与部署复验

- `npm run dist`：通过；ASAR 内 14 个关键源码/资源与工作区逐文件 SHA-256 一致。
- 部署目录：`G:\tool-test\tool-plus`，544 个文件，570,754,918 字节。
- 部署版图片 UI：图片 profile 已配置且 IPC 脱敏；Banana、11 种比例、3 档清晰度、固定 1 张、上传和引用入口均通过。
- 部署版视频 UI：Seedance 默认参数和首尾帧入口回归通过。
- 安装器：`G:\tool-test\文档批量处理工具 Setup 0.5.7.exe`，226,789,717 字节，SHA-256 `489616D3F165AE226D8CC6CAF97C8FE2A394132C388DE9961C50119889B72548`。
- 部署 ASAR SHA-256：`7C129BA8D7D0F7CF99E673F1EA717A6462197728C4D098E4F5A9D7D78C8C9F78`。
- 部署 FlowCanvas Go 后端 SHA-256：`F1135A9CFB740DA1F64288F16D2517FC4F68D7BB219BE1459E4027229914AE45`。
