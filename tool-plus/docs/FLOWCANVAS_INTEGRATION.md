# FlowCanvas 本地集成说明

适用版本：Tool Plus 0.5.18 / FlowCanvas SDK 0.2.0

0.5.17 在既有端口和生成闭环上增加节点级并行运行：独立节点可同时执行，Electron 以三并发队列限制 Go 子进程和模型轮询压力；取消只作用于目标节点。图片 `reference` 输入允许多条边并按连线顺序传给 Go 后端，Nano Banana Pro 最多接收 14 张参考图，显式点击“重新生成”不会复用运行时缓存。

0.5.18 修复旧生成节点重启后退化为素材节点的问题，并把 Go 的真实轮询进度按请求 ID 转发到对应并行节点。Seedance 支持文生视频、首尾帧/参考图生视频和图片/视频/音频混合参考；提交层对 EOF、连接重置、429 和 5xx 使用稳定幂等键重试，失败原因直接显示在节点预览区。

## 1. 定位与边界

FlowCanvas 是 Tool Plus 内置的前端画布引擎 SDK，用于节点式图编辑和本地工作流运行。它与主程序中的经典任务流并存，但职责不同：

- 经典任务流：把 114 项批处理工具按顺序编排，由 Electron 任务管理器和 Go 后端执行，并使用 SQLite 保存定义和运行记录。
- FlowCanvas：编辑节点、边、视口和节点参数，执行 SDK 注册的本地节点运行时，并保存画布图数据。

普通批处理和经典任务流不依赖画布。用户进入画布、编辑、导入、导出和保存时不需要先配置执行参数；真正运行前再由节点运行时校验图和所需配置。

## 2. 生产文件组成

| 文件 | 职责 |
| --- | --- |
| `frontend/index.html` | 主窗口中的 `canvasView`、返回按钮和 `canvasFrame` iframe |
| `frontend/styles.css` | 同窗口画布视图、头部、返回操作和 iframe 尺寸 |
| `frontend/renderer.js` | 记录进入前页面、切换视图、懒加载 iframe、返回和恢复焦点 |
| `frontend/canvas.html` | iframe 内的本地画布文档和 CSP |
| `frontend/canvas-sdk-host.css` | Tool Plus 画布宿主层样式 |
| `frontend/canvas-sdk-adapter.js` | 图迁移、本地节点、运行时、自动保存和宿主兼容 API |
| `frontend/vendor/flowcanvas/flowcanvas.iife.js` | 浏览器可直接加载的 SDK 产物 |
| `frontend/vendor/flowcanvas/styles.css` | SDK 界面样式 |

生产应用不使用 `open-canvas` IPC，也不创建第二个 BrowserWindow。`electron/canvas-preload.js` 仅供 `scripts/verify-toolplus-native-canvas-ui.js` 的独立 Electron SDK 验收夹具使用，源码保留，但通过 `build.files` 明确排除在生产 ASAR 之外。

## 3. 同窗口启动与返回链路

```text
蓝色主页“智能画布”卡片
  → renderer 记录当前视图与焦点
  → showView(canvasView)
  → 首次进入时将 canvasFrame.src 设置为 canvas.html
  → canvas.html 加载本地 SDK IIFE、样式与 Tool Plus 适配层
  → 用户点击“返回进入前页面”
  → 恢复原工具页、任务流页或目录页以及原焦点
```

iframe 只在首次进入时加载。返回主页面不会销毁或重新创建 iframe，再次进入会复用同一实例，因此当前节点、边、视口和本地保存状态可以连续保留。

## 4. 安全与隔离边界

主窗口 Electron 配置：

- `contextIsolation: true`
- `nodeIntegration: false`
- preload 只暴露主应用的窄接口
- 主进程只创建一个应用 BrowserWindow

画布 iframe 配置：

- `sandbox="allow-scripts allow-same-origin"`
- `referrerpolicy="no-referrer"`
- `canvas.html` 使用 `connect-src blob: data:`，只允许读取用户刚选择的本地 Blob/Data URL，不允许 HTTP/HTTPS 外呼
- CSP 同时限制 `object-src 'none'`、`base-uri 'none'` 和 `form-action 'none'`
- `frame-ancestors 'self'` 只允许本地主窗口嵌入
- 画布适配层仅用 `fetch(blob:/data:)` 读取本地选择内容，不持有 OSS 密钥，不允许 HTTP/HTTPS、WebSocket 或 EventSource 外呼

画布页面不能直接获得 Node.js 或文件系统能力，也没有专用画布 IPC。若以后需要让画布节点调用真实工具，必须先定义可审计的输入授权、任务创建、状态回传和取消协议，不能把通用系统对象暴露给 iframe。

## 5. 图数据与持久化

模型执行配置不写入图数据。Electron 用户设置使用 `canvasModels.image` 和 `canvasModels.video` 两个 profile，各自包含 API 地址、模型名和 `safeStorage` 密文。设置页只显示是否已配置；API Key 输入框始终为空，留空保存会保留同地址下的现有密钥，修改 API 地址则强制重新输入密钥。

Tool Plus 适配层使用 `toolplus.flowcanvas.local.v2` 保存当前用户的图数据，并兼容迁移早期本地图格式。标准图包含：

- `schemaVersion`
- 图 `id` 和 `name`
- `nodes`
- `edges`
- `viewport`
- `metadata`

保存流程会先规范化并校验图数据，再写入本机存储。SDK 同时支持 JSON 导入导出，便于备份、调试和迁移。

## 6. 当前本地节点与运行边界

Tool Plus 使用 `includeBuiltinNodes: true` 启用 FlowCanvas SDK 0.2.0 的以下内置节点：

- `prompt`：提示词输入与参数配置
- `image`：NanoBanana Pro 真实图片生成、参考图与本地结果回填
- `video`：Seedance 2.0 真实视频生成、混合素材与本地结果回填
- `audio`：音频生成参数与本地结果模拟
- `compose`：组合上游节点结果

左侧四类创作/生成快捷入口对应 `prompt / image / video / audio`；`compose` 作为合成节点参与图编排。适配层还注册以下 Tool Plus 本地扩展节点：

- `text_input`：文本输入
- `json_input`：JSON 输入
- `local_asset`：本地素材元数据
- `text_transform`：文本转换
- `merge`：合并上游数据
- `delay`：延迟与取消验证
- `output`：输出汇总

图片和视频生成节点已经通过 Electron 的窄 IPC 接到本地 Go 后端。图片节点支持 NanoBanana Pro；视频节点支持 Seedance 2.0 的文生视频、首尾帧、参考图片、参考视频和参考音频参数。浏览器画布只提交文件字节与节点参数；Electron 将素材写入用户目录隔离暂存区；Go 后端校验素材后上传到阿里云 OSS，并生成短期签名 GET URL，再提交模型平台。Go 后端优先读取 `%APPDATA%\tool-plus\flowcanvas-oss.json`，缺少文件或字段时兼容 `FLOWCANVAS_OSS_*` 环境变量；前端页面、图 JSON 和 localStorage 均不接触 OSS AccessKey。

生成节点的界面布局遵循以下约定：

- 参考素材使用独立素材条，图片显示缩略图，音频和视频显示对应类型图标；长文件名省略显示，行内最多展示 4 项，`+N` 在 SDK 顶层打开完整预览库。画布素材选择器同样挂载到 SDK 顶层并定位在节点右侧，不受节点圆角和内容区裁剪。
- 模型、画幅、分辨率、质量、时长、数量等参数控件使用统一高度，并按紧凑、标准和加宽三种固定宽度规格排布；参数区允许按节点模式换行，不得侵入提示词、素材条或提交操作区域。
- 模型的用户显示名与发给后端的请求值分离；触发区保留完整可读名称，展开菜单显示模型说明与分辨率、参考素材数量等能力标签，图数据与宿主调用仍使用模型配置中的准确请求值。
- 明色和暗色主题共用相同的节点尺寸、间距、换行和溢出规则，只由主题令牌控制背景、边框、文字和交互状态颜色。

本地素材上限为图片 25 MiB、音频 50 MiB、视频 500 MiB；单次最多 15 项。任务结束、失败或超时都会清理 Electron 暂存目录。图片/音频/视频最终结果下载到 Electron 用户目录后，以本地 `file:` 媒体地址回填节点，视频可播放、暂停和拖动进度。

进入、编辑、保存、导入或导出画布不要求先完成节点配置。用户点击执行后，运行时才校验必填参数、端口数据类型、节点连接和 DAG；校验失败时运行不会开始，并应在界面显示可定位的问题。运行过程中预览区显示旋转等待/生成遮罩；独立节点可并行执行，单节点取消不影响其他任务，节点状态会在空闲、排队、运行、成功、失败和取消之间更新。

旧图迁移规则：

- `image_generation / video_generation / audio_generation` 分别迁移为 `image / video / audio`，继续使用新版生成节点。
- 旧 `image / video / audio` 只有在包含 `fileName`、`mimeType` 或大于 0 的 `size` 时才迁移为 `local_asset`；没有文件元数据时仍按生成节点处理。
- `local_asset` 只保留文件名、MIME 类型、大小和修改时间等安全元数据；绝对路径、外部地址、令牌和旧远端字段会被清除。

## 7. SDK 公开能力

当前浏览器产物提供：

- 生命周期：`mount`、`unmount`、`destroy`
- 图数据：`import`、`export`、`getGraph`、`validate`
- 编辑：`addNode`、`addEdge`、`undo`、`redo`
- 扩展：`registerNodeType`、节点渲染器、属性面板渲染器、插件和事件订阅
- 运行：`run`、`runNode`、`cancel`、`cancelNode`、`isNodeRunning`
- 保存：自动保存状态与 `flushAutosave`
- 外观：主题和只读模式

生成节点的提示词输入采用编辑手势事务：输入框本地草稿是聚焦和 IME 组合期间的唯一显示值；每个字符以 `record:false, transient:true` 更新图内草稿，不触发整图历史、校验或自动保存；失焦、切换模式或显式撤销前通过 `commitSnapshot` 统一提交一次。React Flow 用户节点始终携带固定 `measured / width / height`，节点数据变化不会触发临时隐藏和焦点丢失。

Tool Plus 的 `window.ToolPlusCanvas` 兼容层额外提供本地保存、清空、导入导出、执行和取消等宿主操作。主页面切换视图时不销毁 SDK；只有主窗口实际卸载时才执行 `destroy`，避免重复绑定事件或丢失返回后的画布状态。

## 8. 扩展节点要求

新增节点至少应包含：

1. 稳定且唯一的节点类型。
2. 明确的输入、输出端口和数据类型。
3. 可序列化的默认数据。
4. 参数校验函数。
5. 支持 `AbortSignal` 的运行函数。
6. 成功、失败和取消路径测试。
7. 旧图数据需要兼容时的迁移规则。

节点运行函数不能依赖未公开的 Electron 对象。需要宿主能力时，应通过经过审计的 SDK service 或窄接口注入。

## 9. 与经典任务流的关系

0.5.10 不把两套编排模型强行合并：

- 经典任务流继续处理真实文件批任务和步骤间文件传递。
- FlowCanvas 负责节点图编辑；图片/视频节点通过窄宿主协议调用本地 Go 模型层，其余节点继续使用 SDK 0.2.0 本地运行时。

后续若要让画布节点调用 114 项工具，应新增明确的执行适配器、输入输出文件授权、任务状态映射和取消协议，并单独完成端到端验收。
