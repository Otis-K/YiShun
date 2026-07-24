# 功能工作台与任务流实施基线登记

适用版本：Tool Plus 0.5.3

## 1. 登记来源

- 原始文件：`D:\QQ\tool-plus-feature-workbench-and-task-flow-plan.md`
- 原始标题：`Tool Plus 功能工作台与任务流完整闭环方案`
- 文件大小：29,568 字节
- 最后修改时间：2026-07-15 19:14:09 +08:00
- SHA-256：`32CEE7505B2E4A2252E6FD928641381A99489581D38AAB37414F642CFD0851C7`

该文件由用户指定为新版工作台和任务流实施规范。为避免把外部路径误当成可随项目迁移的文档，本文件在正式蓝色项目中登记其身份、约束和当前落点。原始文件注明的 0.5.0 是当时源码基线，不代表当前发布版本；本项目按相同产品要求继续实施到 0.5.3。

若原始文件内容或哈希变化，必须先审阅差异并更新本登记，不能静默替换实施基线。

## 2. 已采用的产品约束

### 单功能工作台

- 使用“选择记录 → 功能参数 → 输出设置 → 执行与结果”的完整步骤链。
- 参数和输出布局必须随工具变化，不能用一张万能表单代替。
- 执行前校验真实输入、参数、输出目录和冲突策略。
- 运行后展示状态、日志、结果文件和打开保存位置入口。
- 默认输出新文件，不静默覆盖或破坏原文件。

### 经典任务流

- 任务流与工具目录同级，并提供列表、定义和步骤设置页面。
- 支持步骤新增、修改、复制、删除、排序、启用和停用。
- 第一条启用步骤读取用户输入，中间步骤消费上一条启用步骤产物，最后产物提交到最终输出目录。
- 运行前检查工具存在、步骤启用、输入、参数、输出路径和步骤间数据契约。
- 运行记录和定义使用 SQLite 持久化。
- 支持运行状态、日志、取消、失败重试和检查点恢复。
- 前端授权状态不能代替后端执行边界校验。

## 3. 0.5.3 代码落点

| 基线能力 | 当前实现位置 |
| --- | --- |
| 蓝色主页和工具目录 | `frontend/index.html`、`frontend/styles.css`、`frontend/renderer.js` |
| 四步工作台 | `workbenchInputStep`、`workbenchOptionsStep`、`workbenchOutputStep`、`workbenchResultStep` |
| 动态工具参数 | `backend/tool_catalog.json` 中的 `uiSchema`、`outputProfile` 和工具元数据 |
| 任务流页面 | `workflowView`、`workflowRows`、`workflowStepRows`、`workflowRunPanel` |
| Electron 任务编排 | `electron/workflow-manager.js`、`electron/task-manager.js` |
| SQLite 定义和运行记录 | `backend/workflow_store.go` |
| 工作台界面验收 | `verify/workbench-workflow-ui.test.js` |
| 真实任务流验收 | `scripts/verify-workflow-integration.js` |

智能节点画布不是原方案中经典任务流的替代品。FlowCanvas 与经典任务流是两个入口；两者的边界见 `docs/FLOWCANVAS_INTEGRATION.md`。

## 4. 验收关系

本基线的发布判定必须同时参考：

- `docs/ACCEPTANCE_FLOWCANVAS.md`
- `docs/ACCEPTANCE_SCOPE_WAIVERS.md`
- `docs/DEVIL_STRESS_UI_ACCEPTANCE_PLAN.md`

其中明确获批豁免的项目只能记录为 `WAIVED`，不能记为 `PASS`。0.5.3 版本升级或界面结构修改后，历史 0.5.2 结果不得沿用。
