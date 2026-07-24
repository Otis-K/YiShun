# FlowCanvas SDK 验收记录

验收日期：2026-07-16（Asia/Shanghai）

## 范围

本轮验收对象是前端画布引擎 SDK 和 Electron 可嵌入产物，不包含真实 AI 模型、云账号、计费或媒体生成质量验收。内置图片/视频/音频/合成节点是确定性演示预设。

## 自动化验收门

| 验收门 | 判定 |
| --- | --- |
| TypeScript 工程检查 | `pnpm check` 必须 0 错误 |
| 单元/组件测试 | 所有 Vitest 用例必须通过，不允许 skip |
| 浏览器 E2E | 所有 canvas 与 Electron 用例必须通过 |
| 发布构建 | ESM、CJS、IIFE、CSS、类型必须生成 |
| 实际包消费 | 从 `.tgz` 安装后验证 ESM、CJS、strict TypeScript、IIFE |
| Electron | 真实 Electron 39 `loadFile()` 沙箱窗口，不使用浏览器模拟代替 |

## 压力与边界

- 25,000 节点 DAG 拓扑分析与空间索引/查询。
- 5,000 节点核心 transient 编辑不做整图克隆、不重复整图校验。
- 5,000 节点真实浏览器逐帧编辑：导入预算 `<15s`，20 帧编辑预算 `<10s`。
- 大图运行失败、取消、并发 run token、错误依赖传播、重试上限和有界 LRU。
- 坏 JSON、未来 schema、非 JSON 值、重复 ID、非有限几何、恶意 patch、外部引用别名。
- 插件清理异常、渲染异常、validator 异常、观察者异常和事件 payload 篡改。

## 人工视觉检查

自动截图位于 `artifacts/screenshots`。桌面暗/亮主题已确认画布填满宿主、节点/连线/Inspector 可见；390×844 移动截图已确认画布与 Inspector 均有有效高度、无横向页面溢出。

最终数字以最后一次完整命令输出为准；源码发生修改后必须重新执行全部验收门，不能沿用旧结果。
