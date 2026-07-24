# 画布引用、取消与节点操作验收（0.5.14）

## 功能范围

- 连线右键取消；节点右键暂停、重试、删除。
- A/B 图片输出同时连接 C 的多参考图汇聚，素材数量遵守模型 14 张上限。
- C 保留自己的提示词，同时把上游提示词作为可见的“上游语义”合并提交。
- “选择素材”只选择已完成的媒体结果；`@` 只插入节点语义引用，媒体节点同时加入素材。
- 显式重试只刷新目标节点，已完成上游节点使用缓存，避免重复计费。
- Electron 取消信号穿透到主进程并终止对应 Go 生成子进程。

## 验收记录

| 项目 | 命令 / 方法 | 结果 |
|---|---|---|
| SDK 类型检查 | `pnpm check` | PASS |
| SDK 单元测试 | `pnpm test` | PASS，108 项 |
| 右键交互真实浏览器测试 | Playwright `right-click disconnect` | PASS |
| Tool Plus 多参考图前后端桥接 | `npm run verify:toolplus-native-canvas` | PASS |
| A/B 素材数量与上游语义提交 | 同上，`verifyMultiImageReferenceDagAndRerun` | PASS |
| Go/Electron 源码与数据根验收 | `npm run verify:release-source` | PASS |
| 安装包打包文件验收 | `electron-builder` + `npm run verify:packaged` | PASS，23 个打包文件契约 |
| 旧版运行中覆盖升级 | 4 个旧 Electron 进程运行时静默安装 0.5.14 | PASS，安装器自动关闭进程，退出码 0，无重试弹窗 |
| 安装后版本与启动烟测 | 读取安装目录 `app.asar` 并启动主程序 | PASS，0.5.14，可启动并响应 |

说明：验收不会调用收费的真实生成接口；模型请求采用与正式链路相同的 iframe → Electron → Go 契约模拟，既有真实 API 通路不在本次交互改造中重复扣费验证。
