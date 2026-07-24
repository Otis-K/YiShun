# Tool Plus 0.5.11 图片节点闭环验收

验收日期：2026-07-18

## 修复范围

- 显式点击生成始终发起新任务，不复用上次结果缓存；成功后按钮显示“重新生成”。
- 生成模式切换同步节点 `type`、标题、描述、状态和端口定义。
- 本地图片/视频/音频迁移为独立素材节点，不再携带生成面板状态。
- 本地素材输出由 `json` 改为媒体兼容的 `any`，图片可连接到图片生成节点 `reference` 端口。
- 连线方向固定为右侧输出到左侧输入，取消反向自动交换。
- 图片生成 `reference` 端口支持多条边；多个上游输出按连线收集为数组。
- Nano Banana Pro 参考图上限在 UI、Electron 适配层和 Go 模型层统一为 14。

## 验收结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| FlowCanvas 单元测试 | PASS | 12 files / 107 tests |
| FlowCanvas TypeScript 与浏览器产物 | PASS | `npm run build` |
| Go 全仓单元测试 | PASS | `go test ./...` |
| Electron 画布联调 | PASS | 两个素材节点产生两条边，两份素材进入每次图片请求；连续运行两次产生两个 host 请求 |
| 1200 节点简单压力测试 | PASS | 922 ms |
| 真实单参考图链路 | PASS | OSS 上传、模型完成、PNG 下载并由 Electron 解码 |
| 真实双参考图链路 | PASS | 任务 `task_KpbkLs3CAMAnZ3qhLvRRk22MEtJsrJIH`；2 个 OSS 素材；1024×1024；1,893,853 bytes |

真实双参考图报告：`work/real-image-reference-acceptance.json`。

第一次真实参考图提交曾返回上游 `EOF`，该次记录为失败，随后仅重试参考图链路并通过；未将失败请求计为通过。
