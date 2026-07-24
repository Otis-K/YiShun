# 本轮验收范围豁免

批准日期：2026-07-14

项目负责人在当前 Codex 任务中明确批准本轮不执行以下三项：

1. L4 磁盘满、权限、依赖终止、取消、并发冲突等破坏测试。
2. L5 24 小时/500 任务、100 次启动退出等长稳测试。
3. 5 名真实首次用户可用性测试。

这些项目在机器报告中必须显示为 `WAIVED`，不得显示为 `PASS`，也不得计入通过率。其余《DEVIL_ACCEPTANCE_CLOSURE_PLAN.md》和《DEVIL_STRESS_UI_ACCEPTANCE_PLAN.md》要求继续作为强制门禁，包括 L0–L3、UI 研究与截图矩阵、125% 缩放、前后端联调、Office 原生验证、安装/升级/卸载及源码与二进制身份一致性。

机器可读配置：`verify/devil/acceptance-waivers.json`。
