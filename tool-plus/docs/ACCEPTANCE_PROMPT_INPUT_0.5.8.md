# Tool Plus 0.5.8 生成提示词连续输入修复验收

日期：2026-07-18（Asia/Shanghai）  
交付版本：Tool Plus 0.5.8 / FlowCanvas SDK 0.2.0

## 问题与根因

0.5.7 的生成节点把 `textarea` 直接绑定到图数据，并在每个字符输入后执行一次完整 `engine.updateNodeData` 事务。快速输入会被较旧的受控值回写覆盖；中文输入法组合期间还会被图更新打断。

另一个独立触发点是 React Flow 收到新的用户节点对象时没有获得 `measured` 尺寸，会短暂把节点包装层切换为 `visibility:hidden`。浏览器因此把焦点从输入框移到 `BODY`，用户需要再次点击才能继续输入。

## 修复内容

- 生成提示词在聚焦期间使用组件本地草稿作为唯一受控值。
- 每字符只以 `{ record:false, transient:true }` 同步图草稿，不生成历史记录、不触发 `graph:change`、校验和自动保存。
- 失焦时通过一次 `commitSnapshot` 提交完整编辑；一次撤销只恢复本次提示词，不删除节点。
- `compositionstart` 到 `compositionend` 期间禁止外部图状态覆盖本地输入值。
- React Flow 节点模型始终回填固定 `width / height / initialWidth / initialHeight / measured`，数据变化时不再临时隐藏节点。
- 新增发布门禁 `scripts/verify-canvas-prompt-input.cjs`，默认执行 30 轮真实 Electron 键盘竞态。

## 自动化验收结果

| 验收项 | 结果 |
| --- | --- |
| FlowCanvas SDK 类型检查 | PASS |
| FlowCanvas SDK `tests/ui.test.ts` | 21/21 PASS |
| FlowCanvas SDK 全量测试 | 12 个测试文件、105/105 PASS |
| 快速英文逐字符 + 中文 composition 单元回归 | PASS；编辑中焦点保持，失焦前 0 次 `graph:change`，失焦后恰好 1 次 |
| Tool Plus 源码发布验收 | PASS；114 项工具目录、画布、任务流、模型配置隔离均通过 |
| 1200 节点简单压力 | PASS；导入/校验/导出与渲染验收 1,950 ms |
| 源码版真实 Electron 快速输入 | 30/30 PASS；每轮 34 字符，0 次丢焦点，0 次隐藏 |
| 部署版真实 Electron 快速输入 | 30/30 PASS；每轮 34 字符，0 次丢焦点，0 次隐藏 |
| 一次撤销语义 | 30/30 PASS；提示词恢复为空且节点保留 |
| 打包 ASAR/版本/沉浸式界面验证 | PASS |
| 部署版图片与视频节点参数回归 | PASS |

## 发布物与一致性

- 绿色目录：`G:\tool-test\tool-plus`
- 安装器：`G:\tool-test\文档批量处理工具 Setup 0.5.8.exe`
- 被替换版本备份：`G:\tool-test\tool-plus.backup-20260718-134316`

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| Setup 0.5.8 | 226,790,040 | `B96C3BD1596F11ED87BD36B1B3AF9E46D6CE92F5A5AAF213E66582E1D3B7CC74` |
| 部署主程序 EXE | 210,899,968 | `2640C1F141B29E59235B92018A14F0F2632C0368935543DDEE7C5632B2696B44` |
| 部署 `app.asar` | 813,653 | `34CF44974DD5A23C8DC2FAEACBE497F82F9B56203780AFBC5A651A7DC2E165D5` |
| SDK 浏览器产物 | 494,344 | `A902DAEA2DF54FBB7BBAF086BAE75FDAEB34B630B374C12AF4934699D39F2852` |

源码 SDK `dist/flowcanvas.iife.js` 与 Tool Plus `frontend/vendor/flowcanvas/flowcanvas.iife.js` 哈希一致；构建目录、部署目录和安装器字节/哈希均已核对。

## 验收边界

- 本轮没有再次发起付费图片或视频生成请求；图片、视频真实 API 闭环沿用 0.5.7 已完成的脱敏验收证据，本轮只复验其部署 UI 和参数入口未回归。
- 中文输入法由 React composition 事件回归覆盖；真实 Electron 键盘竞态使用英文逐字符输入执行 30 轮，不把事件模拟描述成 30 轮人工中文输入法测试。
- 本轮没有在干净虚拟机上执行安装/卸载，也没有商业代码签名。
