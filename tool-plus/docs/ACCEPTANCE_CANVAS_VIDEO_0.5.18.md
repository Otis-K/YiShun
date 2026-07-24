# Tool Plus 0.5.18 画布生成闭环验收

验收日期：2026-07-18

## 本次修复

- 修复旧版生成结果在重启迁移时被误判为普通素材，恢复完整生成节点、参数、提示词、任务标识和编辑器。
- Electron 解析 Go 后端逐行进度事件，并按请求 ID 转发到对应节点，支持三任务并行且互不串进度。
- Seedance 提交增加瞬时 EOF、连接重置、429 和 5xx 重试；重试使用稳定幂等键，避免重复提交。
- 视频节点支持 `text2video`、首尾帧/参考图 `image2video`、参考图片/视频/音频 `mixed2video`，并执行图片 9、音频 3、混合素材 15 的模型限制。
- Seedance 参数限定为接口能力：比例 `adaptive/16:9/4:3/1:1/3:4/9:16/21:9`，分辨率 `480p/720p`，时长 4–15 秒，声音 `on/off`。
- 参数下拉改为主题自适应的能力列表；失败原因覆盖显示在节点预览区；素材选择列表支持滚动；移除顶部“添加更多节点”，上传入口保留在左侧节点抽屉。
- 节点/连线右键菜单点击画布空白处自动关闭。

## 自动化与联调结果

| 验收项 | 结果 |
|---|---|
| FlowCanvas SDK 单元测试 | PASS，12 文件、108 项 |
| Go Backend SDK 全包测试 | PASS |
| Seedance EOF 重试与幂等键 | PASS，专用单元测试 |
| Tool Plus 发布源验收 | PASS |
| 生成节点重启完整恢复 | PASS |
| 三任务并行与独立取消 | PASS，峰值并发 3 |
| 平台进度转发到节点 | PASS，原生 Electron IPC/请求 ID 联调 |
| 首尾帧、参考视频、参考音频参数桥接 | PASS，Electron → Go 完整负载验收 |
| 生成视频节点内播放 | PASS |
| 1200 节点压力场景 | PASS，5196 ms |
| 输入框稳定性 | PASS，30 轮、焦点丢失 0 |
| 两步真实文档任务流 | PASS，SQLite/TaskManager/后端闭环 |

## 真实模型平台验收

真实请求已到达 `https://api.tmlab.store/v1/tasks`。重新使用用户确认的视频凭据后，响应分组已由错误的 `seedance` 变为正确的 `default`，证明凭据和分组映射已纠正；平台在三次瞬时重试后返回：

`HTTP 503 model_not_found：分组 default 下模型 seedance-2.0-fast 无可用渠道（distributor）`

因此本次不能签署“真实 Seedance 已出片”。这是外部模型平台当前无可用渠道，不是参数、素材上传、Electron IPC 或 Go 队列失败。原始报告保存在 `work/real-video-acceptance.json`。

## 发布门槛

安装包必须完成 one-click 原地升级两轮、安装后版本检查、启动冒烟和退出后无残留进程检查；任一项失败不得交付。

## 安装交付结果

- `G:\tool-test` one-click 原地升级：PASS，连续两轮。
- 两轮均主动启动已安装应用后执行升级，未出现“无法关闭/重试”对话框。
- 安装后版本：`0.5.18.0`。
- 安装后启动冒烟：PASS；退出后 Tool Plus、Tool Plus Backend、FlowCanvas Backend 残留进程均为 0。
- 安装包 SHA-256：`0055F388F49C3AE2D8F9C45D4D4B29F271B7E51E9C22BC07587553130E301189`。
- 安装后/构建 `app.asar` SHA-256：`03419D9FB504CDCA0E28679ABA21A65DCFE5F4D2242F8E3CFE813E31E52B36A2`，两者一致。
