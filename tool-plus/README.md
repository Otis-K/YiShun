# Tool Plus 0.5.17

Tool Plus 是一款面向 Windows 的本地文档批量处理桌面工具，采用 Electron + Go + Python bridge 组合实现。当前源码包含 114 项工具、蓝色桌面工作区、经典任务流和本地 FlowCanvas SDK 0.2.0 画布。

## 当前桌面体验

### 蓝色主页

- 深蓝色品牌栏、浅蓝色侧栏选中态和白色功能卡片。
- 侧栏按任务流、全部工具、文件名称、文件夹名称、文件整理、Word、Excel、PowerPoint、PDF、文本、图片、视频、音频和更多工具分类。
- 主页支持分类浏览、功能卡片和快速搜索；不同工具进入各自的参数与预览布局。

### 四步功能工作台

单项工具按以下顺序形成完整操作闭环：

1. 选择输入：添加文件、导入文件夹并核对记录。
2. 功能参数：按工具类型显示专用参数，不用通用表单代替。
3. 输出设置：选择保存位置、目录策略和冲突策略。
4. 执行与结果：执行前校验、任务状态、日志、结果路径和再次执行。

原文件默认只读，处理结果写入输出目录。任务成功后会显示结果路径并提供“打开保存位置”。

### 经典任务流

经典任务流用于把多个批处理工具按步骤顺序执行，和节点画布是两个独立入口。当前界面支持：

- 新建、修改和删除任务流；
- 添加、复制、启用、停用、排序和删除步骤；
- 保存单项工具为任务流步骤；
- 运行前校验、运行状态和步骤进度；
- 取消、失败重试和检查点恢复；
- 本地 SQLite 持久化任务流定义和运行记录。

### 本地 FlowCanvas SDK 0.2.0

“智能画布”作为主窗口视图栈中的独立页面加载，不会新建第二个 Electron 窗口。首次进入时，主页面把 `canvas.html` 懒加载到受限 iframe；点击“返回进入前页面”会回到原工具页、任务流页或目录页，并保留当前画布实例。当前集成包括：

- 无限画布平移、缩放、适应视图和缩略图；
- 节点添加、拖动、框选、多选、复制粘贴和端口连线；
- 撤销、重做、图校验和 DAG 环路拦截；
- JSON 导入导出、版本迁移和本地自动保存；
- 节点注册、渲染扩展、插件和事件接口；
- 本地执行、取消、重试、缓存和状态反馈；
- `mount / destroy / import / export` 等 SDK API。

Tool Plus 启用了 SDK 的 `prompt`、`image`、`video`、`audio` 和 `compose` 内置节点。`image` 已接入 NanoBanana Pro 图片任务 API，支持 1K/2K/4K、11 种画幅以及远程/本地参考图；`video` 已接入 Seedance 2.0，支持文生视频、图片生视频与混合素材模式。浏览器画布不持有模型或 OSS 密钥，只通过受限宿主消息把参数和用户选择的本地素材交给 Electron，再由本地 Go 后端完成队列、轮询、OSS 临时签名、结果下载和节点回填。`prompt`、`audio` 和 `compose` 仍使用本地运行时。画布进入、编辑、保存和导入导出不要求预先配置；点击执行时才校验必填参数、端口连接与 DAG，校验失败会阻止运行并显示问题。

0.5.10 的 Go 画布后端会自动读取 `%APPDATA%\tool-plus\flowcanvas-oss.json`，普通用户双击启动软件后也能把本地图片、视频和音频上传 OSS，再将临时签名 URL 提交给图片或视频模型。配置文件字段可用环境变量兜底，不会写入前端画布 JSON。

0.5.9 的生成节点把参考素材与参数控制分成独立布局区域：参考图片显示为带缩略图、文件名省略和移除操作的素材条，更多素材以计数收束；模型、画幅、质量、数量等参数使用统一高度和紧凑/标准/加宽三档固定规格，长内容不会挤占提交按钮。模型选择器只展示面向用户的名称，提交到后端时仍保留准确的模型请求值。明色和暗色主题使用相同的几何布局与溢出规则，只切换主题色彩。

0.5.8 起，生成节点提示词在编辑期间使用本地草稿，逐字输入只做轻量瞬态同步，失焦时才形成一次历史记录和自动保存；React Flow 节点模型同时保留固定测量尺寸，避免数据更新时节点短暂隐藏并打断输入法或键盘焦点。

旧图中的 `image_generation / video_generation / audio_generation` 会迁移到对应的新版生成节点；只有旧 `image / video / audio` 节点包含 `fileName`、`mimeType` 或有效 `size` 文件元数据时，才迁移为只保存安全元数据的 `local_asset`。

画布资源随应用分发，图数据保存在当前 Windows 用户的数据空间。详细接入说明见 [docs/FLOWCANVAS_INTEGRATION.md](docs/FLOWCANVAS_INTEGRATION.md)，验收口径见 [docs/ACCEPTANCE_FLOWCANVAS.md](docs/ACCEPTANCE_FLOWCANVAS.md)。

iframe 使用 `sandbox="allow-scripts allow-same-origin"`，画布页面 CSP 只允许读取 `blob:` / `data:` 本地素材，不允许直接发起 HTTP/HTTPS 请求。生产主窗口不通过 preload 或 IPC 创建画布窗口；`electron/canvas-preload.js` 仅供独立 SDK Electron 验收夹具使用。

## 技术路线

- Electron：单一主窗口、主窗口内嵌画布、经典任务流 IPC 和安装包。
- Go：工具清单、任务分发、任务流存储和主要文档处理。
- Python bridge：复杂格式兼容处理，随安装包分发。
- pdfcpu：PDF 加密、解密、删页、水印、图章、旋转和重排。
- ExifTool：图片元数据写入与清除。

## 应用数据目录

- Windows 默认保存到 `G:\tool-plus-data`；如果设备没有 G 盘，则回退到 `%APPDATA%\tool-plus`。
- 画布图数据、生成的图片/视频、任务记录、应用设置、模型/OSS 配置及 SQLite 数据库统一使用该目录。
- 用户可在“设置 → 应用数据存储”选择任意可写绝对路径。保存后重启应用，持久数据会自动复制到新目录并从新目录运行；缓存不会迁移。
- 当前目录指针保存在 `HKCU\Software\ToolPlus`，因此覆盖安装或升级不会把数据位置重置回 C 盘。
- FFmpeg：视频与音频处理。
- yt-dlp：提取用户有权保存的公开网页视频。

正式安装包内置运行资源，普通用户不需要单独安装 Node.js、Go、Python 或音视频工具。

## 工作区

默认工作区根目录为 `G:\tool-user-file`。应用会为工具建立输入和输出目录；用户也可以在“设置 → 文件”中修改并持久化工作区根目录。

文件和文件夹重命名类功能输出新副本，不直接改写原数据。网页视频功能只适用于用户有权保存的公开内容，不绕过 DRM、登录、付费墙或访问控制。

## 开发与构建

启动开发版：

```powershell
npm run dev
```

构建后端和运行资源：

```powershell
npm run build:pdf-helper
npm run build:bridge
npm run build:backend
```

生成目录版：

```powershell
npm run pack
```

生成 Windows 安装器：

```powershell
npm run dist
```

`dist` 会先执行完整源码、同窗口画布、蓝色工作台和真实任务流门禁，构建后再执行 ASAR 与源码身份校验。包后校验缺失、版本不符或任一关键文件哈希不一致都会失败，不会以跳过状态冒充通过。

## 验收入口

以下命令是可复现的验收入口；每次交付必须以本次命令的实际退出码、日志、截图和产物检查为准，不能沿用历史结论：

```powershell
npm run verify:source
npm run verify:local-canvas-shell
npm run verify:immersive-ui
npm run verify:toolplus-native-canvas
npm run verify:blue-workbench
npm run verify:workflow-integration
```

工作台与任务流实施基线登记在 [docs/FEATURE_WORKBENCH_TASK_FLOW_BASELINE.md](docs/FEATURE_WORKBENCH_TASK_FLOW_BASELINE.md)。

安装包还需要在独立目录完成真实安装、启动、任务执行和卸载检查，源码测试不能替代安装版验收。
