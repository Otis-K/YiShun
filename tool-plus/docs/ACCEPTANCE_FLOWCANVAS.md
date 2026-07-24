# FlowCanvas 与蓝色工作区验收说明

适用版本：Tool Plus 0.5.3 / FlowCanvas SDK 0.2.0

## 验收状态

0.5.3 已完成本轮源码、包后、安装版和简单压力验收。0.5.2 的日志、截图、ASAR、安装器、安装/卸载记录、耗时、大小和哈希未替代本轮执行，也未复制为 0.5.3 结果。

验收原则：

- 只记录本轮命令的真实退出码、日志、截图和输出。
- 自动化退出码为 0 只是必要条件，还要核对截图、输出文件和安装版行为。
- 任一失败修复后，重新执行受影响用例及相邻回归。
- 包后门禁出现缺包、版本不符或源码身份不一致时必须失败，不允许记为跳过并返回 0。
- 安装包验收必须针对最终交付 Setup；开发目录和 `win-unpacked` 不能代替真实安装。

## 1. 发布前源码门

统一入口：

```powershell
npm run verify:release-source
```

它依次执行：

```powershell
npm run verify:source
npm run verify:local-canvas-shell
npm run verify:immersive-ui
npm run verify:toolplus-native-canvas
npm run verify:blue-workbench
npm run verify:workflow-integration
```

不得只截取其中一个命令作为整体验收结论。

## 2. 主窗口同页画布合约

`verify:local-canvas-shell` 和 `verify:immersive-ui` 至少验证：

1. 主进程只创建一个应用 BrowserWindow。
2. 主文档包含 `canvasView`、`canvasBackBtn` 和 `canvasFrame`。
3. iframe 初始不加载，进入画布时才把 `data-src="canvas.html"` 写入 `src`。
4. renderer 记录进入前页面和焦点，返回后正确恢复。
5. 返回再进入时复用同一 iframe，不清空当前图。
6. 主进程不存在 `open-canvas` IPC 或画布窗口管理器。
7. 主窗口 preload 不暴露画布窗口打开 API。
8. iframe 含 `sandbox="allow-scripts allow-same-origin"` 和 `referrerpolicy="no-referrer"`。
9. `canvas.html` CSP 使用 `connect-src 'none'` 与 `frame-ancestors 'self'`。
10. 画布适配层不包含 Node、IPC 或网络客户端。
11. 适配层启用 SDK 0.2.0 内置节点，并公开 `prompt / image / video / audio / compose`。
12. 左侧四类创作/生成入口可分别添加 `prompt / image / video / audio`，进入画布和编辑节点不要求先完成执行配置。

## 3. SDK 独立能力验收

执行：

```powershell
npm run verify:toolplus-native-canvas
```

该命令会使用测试专用 `electron/canvas-preload.js` 创建隔离的 Electron SDK 验收窗口，验证 SDK 本身，而不是生产主窗口导航。至少覆盖：

- SDK IIFE 真实挂载；
- 节点、连线、端口类型与 DAG 环路拦截；
- 拖动、框选、多选、复制粘贴、删除、撤销和重做；
- 平移、缩放和适应视图；
- JSON 导入导出与自动保存恢复；
- `prompt / image / video / audio / compose` 五个 SDK 0.2.0 内置节点可创建、保存、导入和运行；
- 左侧 `prompt / image / video / audio` 四类快捷入口均可达，`compose` 能组合上游本地结果；
- `LocalWorkflowRuntime` 的纯本地 demo 运行、取消、重试、缓存和状态反馈；
- 未配置必填参数、端口不兼容或存在 DAG 环路时，执行前校验必须阻止运行并显示明确问题；
- demo 结果不得冒充真实图片、视频或音频文件，运行过程不得调用真实生成模型或上传提示词/素材；
- 旧 `image_generation / video_generation / audio_generation` 分别迁移为 `image / video / audio`；
- 带 `fileName`、`mimeType` 或有效 `size` 的旧 `image / video / audio` 迁移为 `local_asset`，不带文件元数据的同名节点仍保持生成节点；
- `local_asset` 导入后只保留安全文件元数据，不保留绝对路径、外部地址、令牌或旧远端字段；
- 零网络请求；
- 不连接任何外部代理服务；
- 关闭与重新挂载；
- 约定规模的大图压力用例。

必须保留命令日志和完整画布截图。测试 preload 只服务此验收夹具，生产 ASAR 不得包含它。

## 4. 实际主窗口、工作台和任务流界面

执行：

```powershell
npm run verify:blue-workbench
```

至少核对：

- 深蓝顶部、浅蓝侧栏选中态和白色工具卡片；
- 工具对应的四步工作台和专用参数；
- 任务流列表、步骤设置和运行面板；
- 从主页进入同窗口画布时 BrowserWindow 数量不增加；
- iframe 成功加载 SDK 并产生本地图；
- 返回进入前页面后图仍保留；
- 焦点回到进入画布前的入口；
- 截图不存在遮挡、空白画布或不可达操作。

此命令用于真实 Electron 界面与导航验收；其中的 preload 数据夹具不能替代后端集成。

## 5. 真实经典任务流集成

执行：

```powershell
npm run verify:workflow-integration
```

必须使用实际 Backend EXE、TaskManager、WorkflowManager 和 SQLite，不使用 mock preload。至少验证：

- 创建两步可串联工作流；
- Markdown → HTML → TXT 真实输入输出；
- 上一步产物传递给下一步；
- 产物清单、检查点和最终原子提交；
- 源文件保持不变；
- SQLite 重开后的 `run-get` 与 `run-list`；
- 最终记录状态为 `completed`；
- 无后端或 Electron 测试残留进程。

## 6. 114 项工具回归

`verify:source` 必须真实核对 114 项共享清单、各类代表性输出、PDF helper 源码与 EXE、Go 回归和前端目录一致性。若任何依赖缺失或用例没有执行，必须记录为未执行，不能计为通过。

## 7. 构建和包后身份门

0.5.3 构建完成后执行：

```powershell
npm run verify:packaged
```

至少验证：

1. `release/win-unpacked/resources/app.asar` 必须存在。
2. 源码和包内 `package.json` 版本都必须为 0.5.3。
3. 蓝色主页、四步工作台、经典任务流、`canvasView` 和 iframe 文件齐全。
4. 主进程只包含一个 BrowserWindow，包内没有画布窗口 IPC。
5. `electron/canvas-preload.js` 不得进入生产 ASAR。
6. frontend 关键页面/样式/renderer、Electron main/preload/settings/task/workflow，以及预期的 SDK 0.2.0 IIFE/CSS 必须与当前源码逐文件 SHA-256 一致。
7. 画布 CSP、零网络、SDK 0.2.0 内置节点和纯本地 demo 运行时合约成立。
8. 四类创作/生成入口、执行前校验和旧图迁移规则必须与源码适配层一致。
9. 不含已移除的旧远端服务文件名、地址、路由或凭据字段。

缺失包、版本不符和任一哈希不一致都必须返回非零退出码。

## 8. 最终 Setup 安装版验收

计划安装器：`G:\tool-plus-v2\tool-plus-v3\文档批量处理工具 Setup 0.5.3.exe`

本轮结果：

- 安装器大小：224,685,360 字节
- 安装器 SHA-256：`720517F9ECEBCBFE0F9D4A1283406048C5CF1AE4A6F18C288C0D9FE5B1F02AC7`
- ASAR SHA-256：`28F29DCFFEA583FBD9ACCB6CF7A09F82F520A7F6E99C2B9D0D190BBF6A3F86E7`
- 安装/卸载退出码：`0 / 0`
- 签名状态：`NotSigned`
- 安装版同窗口画布截图：`work\ui-acceptance\installed-0.5.3-canvas.png`
- UI 矩阵：288 张截图，100%/125% 缩放，1000 项批量输入，布局失败 0。

生成最终文件后必须：

1. 记录安装器字节数、SHA-256、签名状态和生成时间。
2. 在隔离目录完成真实安装并核对退出码。
3. 从安装后的程序启动 GUI，确认版本为 0.5.3。
4. 读取 114 项工具并完成至少一个真实单工具任务。
5. 完成真实两步经典任务流并重开 SQLite 记录。
6. 在主窗口打开画布，确认无第二窗口、能返回原页且图状态保留。
7. 在 Windows 125% 缩放下核对主页、工作台、任务流和画布。
8. 正常退出、卸载并检查安装目录、快捷方式和进程残留。
9. 将实际安装器复制到交付目录后再次计算哈希，确认与受验文件完全一致。

## 9. 0.5.3 结果表

| 检查项 | 命令或操作 | 当前状态 | 证据路径 |
| --- | --- | --- | --- |
| 源码回归 | `npm run verify:source` | PASS | `work\verify` |
| 同窗口画布合约 | `npm run verify:local-canvas-shell` | PASS | 命令日志 |
| 主界面合约 | `npm run verify:immersive-ui` | PASS | 命令日志 |
| SDK 独立能力 | `npm run verify:toolplus-native-canvas` | PASS | `work\canvas-screens\flowcanvas-sdk-local-only.png` |
| 蓝色工作区和同页导航 | `npm run verify:blue-workbench` | PASS | `work\ui-acceptance` |
| 真实任务流集成 | `npm run verify:workflow-integration` | PASS | `work\workflow-integration` |
| 生产 ASAR 身份 | `npm run verify:packaged` | PASS | 命令日志 |
| 最终 Setup 安装运行 | 安装、运行、任务、画布、卸载、0.5.3 快捷方式残留检查 | PASS | `work\ui-acceptance\installed-0.5.3-canvas.png` |

用户已豁免 L4 破坏测试、L5 24 小时/500 任务/100 次启停和 5 名真实首次用户测试；这些项目不显示为 PASS，也不计入本轮结论。
