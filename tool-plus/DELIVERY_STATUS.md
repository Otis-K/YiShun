# Delivery Status

日期：2026-07-18  
版本：0.5.8

## 本轮交付结论

Tool Plus 0.5.8 已修复生成节点提示词快速输入吞字、中文输入法组合状态被覆盖以及节点更新时短暂隐藏导致的焦点丢失，并已构建和部署到 `G:\tool-test`。0.5.7 已交付的图片/视频模型配置、NanoBanana、Seedance、OSS 素材上传、Go 队列轮询和原节点结果回填闭环保持不变。

图片和视频模型现使用两个独立配置。每个配置单独保存 API 地址、模型名和 Windows `safeStorage` 加密密钥；读取型 IPC 不返回密文或明文。修改已配置模型的 API 地址时必须重新输入对应密钥。旧版单配置只迁移到模型所属的一项能力，不会再同时供图片和视频使用。

## 图片节点能力

- 模型：`nano-banana-pro(特价版 1)`。
- 文生图与参考图生图。
- 1K、2K、4K。
- `auto / 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9`。
- 多张远程或本地参考图；混合时保持用户原始顺序。
- 扩展参数透传；已显式设置的请求参数不会被默认值覆盖。
- 本地素材经 Electron 隔离暂存和 Go OSS 短期签名上传，模型与 OSS 密钥不进入画布页面。
- 完成图片下载到当前用户目录并回填原图片节点。

## 验收结果

通过项：

- `go test -timeout 120s ./...`：FlowCanvas Backend SDK 全包通过。
- `npm run verify:model-profiles`：图片/视频密钥隔离、加密落盘、IPC 脱敏、地址变更重输密钥通过。
- `npm run verify:toolplus-native-canvas`：图片参数、远程/本地参考图、顺序、非空素材字节和 1,200 节点简单压力通过。
- `pnpm test`（FlowCanvas SDK）：12 个测试文件、105/105 通过；快速英文和中文 composition 专项 UI 回归 21/21 通过。
- `npm run verify:canvas-prompt-input`：源码版及最终部署版各执行 30 轮真实 Electron 快速键盘输入；每轮 34 字符，吞字 0、焦点丢失 0、节点隐藏 0；一次撤销仅撤回提示词且节点保留。
- `npm run verify:real-image`：两条真实计费链路均通过。
  - 2K、16:9 文生图：`completed`，2752 × 1536 PNG，6,704,241 字节。
  - 1K、1:1 本地参考图生图：`completed`，1024 × 1024 PNG，1,619,771 字节；OSS 上传证据 1 条。
- `npm run verify:release-source`：后端构建、114 项目录与代表性后端回归、蓝色工作台、任务流、画布、1200 节点压力、模型配置隔离和输入竞态全部通过。
- `electron-builder --win nsis` 与 `npm run verify:packaged`：NSIS、ASAR、版本和本地资源验证全部通过。
- 部署版图片 UI：独立图片配置已读取，Banana 模型、3 档清晰度、11 种比例、上传与参考选择入口通过。
- 部署版视频 UI：Seedance 模型、模式、比例、分辨率、时长、声音和首尾帧入口回归通过。

本轮输入修复明细见 `docs/ACCEPTANCE_PROMPT_INPUT_0.5.8.md`。图片真实验收明细仍见 `docs/ACCEPTANCE_IMAGE_MODEL_0.5.7.md` 和 `work/real-image-acceptance.json`。报告不含 API Key、Authorization 或 OSS/模型公网地址。

## 发布物

- 绿色目录：`G:\tool-test\tool-plus`
- 安装器：`G:\tool-test\文档批量处理工具 Setup 0.5.8.exe`
- 被替换 0.5.7 目录备份：`G:\tool-test\tool-plus.backup-20260718-134316`
- 本轮验收文档：`G:\tool-test\Tool-Plus-0.5.8-生成提示词连续输入验收.md`
- 图片验收文档：`G:\tool-test\Tool-Plus-0.5.7-图片模型与生图验收.md`
- 图片验收 JSON：`G:\tool-test\real-image-acceptance-0.5.7.json`
- 两张实际生成样图：`G:\tool-test\nano-banana-text-2K-16x9.png`、`G:\tool-test\nano-banana-reference-1K-1x1.png`

关键哈希：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| Setup 0.5.8 | 226,790,040 | `B96C3BD1596F11ED87BD36B1B3AF9E46D6CE92F5A5AAF213E66582E1D3B7CC74` |
| 主程序 EXE | 210,899,968 | `2640C1F141B29E59235B92018A14F0F2632C0368935543DDEE7C5632B2696B44` |
| app.asar | 813,653 | `34CF44974DD5A23C8DC2FAEACBE497F82F9B56203780AFBC5A651A7DC2E165D5` |
| Tool Plus Go 后端 | 11,695,104 | `91864E5CF9CDEA7752BFC7EC7DB6FCCE2B6BE4C483C8FDDA4616C6698D3A2BB4` |
| FlowCanvas Go 后端 | 6,730,240 | `F1135A9CFB740DA1F64288F16D2517FC4F68D7BB219BE1459E4027229914AE45` |

## 明确边界

- 本轮没有重复发起付费图片/视频生成；真实计费结果沿用 0.5.7 已验收的两个代表图片组合和 Seedance 样例，没有把部署 UI 回归表述为新的计费生成。
- 中文输入法由 composition 自动化覆盖；30 轮真实 Electron 键盘竞态是英文逐字符输入，没有表述为人工中文输入法 30 轮。
- Python bridge 源环境在本轮构建时不可用，流水线复用了既有已验证 EXE，并再次运行其回归；未把它表述为本轮从源码重新编译。
- 已真实启动和操作 `G:\tool-test\tool-plus` 的部署版；本轮没有在干净虚拟机中执行 NSIS 安装/卸载。
- 安装器未做商业代码签名，Windows 可能显示 SmartScreen 提示。
