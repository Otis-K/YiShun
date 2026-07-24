# Tool Plus 0.5.9 生成节点布局验收

## 状态

- 目标版本：Tool Plus 0.5.9
- 验收范围：图片、视频、文本和音频生成节点的素材条、参数控制区、模型选择器及明暗主题布局
- 总体状态：安装包与源码验收 PASS；`G:\tool-test\tool-plus` 现场目录替换 PENDING
- 验收结论：0.5.9 安装包可交付；旧版窗口仍在运行，未强杀进程、未冒充完成目录替换

本文档是验收执行清单，不预填通过结论。只有在对应场景实际运行、截图或日志证据落盘且结果符合预期后，才能把单项状态改为 `PASS`。任一必测项未执行或失败时，总体状态必须保持 `PENDING` 或标记为 `FAIL`。

## 设计基线

1. 参考素材位于独立素材条内；图片显示缩略图，音频和视频显示类型图标，文件名超长时省略，移除按钮始终可见且可操作。
2. 素材数量超过当前宽度时，以“+N”收束，不得让素材名称覆盖参数、提示词或提交按钮。
3. 参数控件统一为固定高度，并采用紧凑、标准和加宽三档宽度；同一参数在切换选项后不得因文本长度改变控件几何尺寸。
4. 模型选择器显示简洁用户名称，图数据和后端请求仍使用完整模型请求值；切换显示名不得改变实际请求模型。
5. 明色与暗色主题共用同一布局、间距、换行和溢出规则，只改变视觉令牌。
6. 视频模式参数允许在限定区域内规范换行，不能与提交按钮或节点边界重叠。

## 验收清单

| 编号 | 场景 | 验收方法 | 预期结果 | 证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| GL-01 | 图片节点添加 1 个长文件名参考图 | 打开图片节点，添加本地图片并观察素材条 | 缩略图、截断文件名和移除按钮均在素材条内，无横向越界 | Playwright 真实 Chrome 几何断言与暗/亮截图 | PASS |
| GL-02 | 图片节点添加多张参考图 | 连续添加素材直至超出一行可用宽度 | 可见素材保持可操作，剩余数量以“+N”显示，不挤压参数和提交按钮 | 4 个超长中英文素材名；素材条、参数区 `scrollWidth <= clientWidth + 1` | PASS |
| GL-03 | 删除素材 | 点击每个可见素材的移除按钮 | 仅删除目标素材，计数和布局即时恢复，无残留遮挡 | `tests/ui.test.ts` 素材删除与预览回退用例 | PASS |
| GL-04 | 参数控件尺寸稳定 | 依次切换模型、画幅、质量和数量选项 | 控件高度一致；紧凑、标准、加宽三档宽度不随选项文本抖动 | 切换长选项前后宽度保持 132/116/84/70px | PASS |
| GL-05 | 视频参数换行 | 切换文本生视频、图片生视频及混合素材模式 | 参数在限定区域内规范换行，不侵入提示词、素材条、提交按钮或节点边界 | 暗/亮主题均严格两行，真实边界断言通过 | PASS |
| GL-06 | 模型显示名与请求值分离 | 选择具有简洁显示名的模型并检查导出图或宿主请求 | 界面显示简洁名称，导出数据和请求仍包含准确模型值 | 打包程序显示 `Nano Banana Pro` / `Seedance 2.0 Fast`；配置值仍为完整 API model | PASS |
| GL-07 | 暗色主题布局 | 在暗色主题重复 GL-01 至 GL-06 | 几何尺寸与明色一致，文字、边框、菜单和交互状态清晰 | `generation-layout-image-dark.png`、`generation-layout-video-dark.png` | PASS |
| GL-08 | 明色主题布局 | 在明色主题重复 GL-01 至 GL-06 | 无暗色残留，素材缩略图、参数文字和弹出菜单对比度正常 | `generation-layout-image-light.png`、`generation-layout-video-light.png` | PASS |
| GL-09 | 节点边界与滚动 | 输入长提示词并添加多素材，检查节点各区域 | 内容按约定滚动或收束，节点 `scrollWidth` 不大于可视宽度，纵向区域不重叠 | 提示词连续输入 30 轮无失焦；全部布局容器水平溢出 <= 1px | PASS |
| GL-10 | 提交操作可达 | 在各生成模式和两种主题下定位并点击提交按钮 | 提交按钮位置固定、未被参数或素材覆盖，键盘与鼠标均可操作 | 提交组位于 footer 内且与所有参数控件不相交；图片/视频宿主桥接用例通过 | PASS |

## 执行记录

| 项目 | 记录 |
| --- | --- |
| 执行日期 | 2026-07-18 |
| 执行人 | Codex |
| 源码提交或产物标识 | Tool Plus 0.5.9 / FlowCanvas SDK 0.2.0；IIFE `A4AE86DA...544B66`；CSS `5B528005...A999A7` |
| Windows 缩放与分辨率 | Playwright viewport 1440×900；本轮未声称覆盖 Windows 125% 系统缩放 |
| 自动化命令及退出码 | SDK 105/105 PASS；新增 Playwright 2/2 PASS；`verify:release-source` PASS；`verify:packaged` PASS；打包程序图片/视频 UI PASS |
| 明色主题截图 | `G:\FlowCanvas-SDK\FlowCanvas-SDK\artifacts\screenshots\generation-layout-image-light.png`、`generation-layout-video-light.png` |
| 暗色主题截图 | `G:\FlowCanvas-SDK\FlowCanvas-SDK\artifacts\screenshots\generation-layout-image-dark.png`、`generation-layout-video-dark.png` |
| 缺陷与复测记录 | 首轮发现视频参数区向下越界约 4px；调整为 footer 79px / controls 70px 后复测 2/2 PASS。缩略图曾触发远程 URL 加载，限制为仅渲染本地 blob/data 后，零网络请求验收 PASS。 |

## 安装包

- 路径：`G:\tool-test\文档批量处理工具 Setup 0.5.9.exe`
- 大小：226,790,375 字节
- SHA-256：`C4535A5450C22746B627495CD6DBB4876E91D5B0A4406E512C1EA4DBC5B5678C`
- 打包内容检查：PASS，版本 0.5.9，22 个关键文件与本地画布安全约束通过。

## 第二张截图故障诊断

底部 `configure local reference upload: FLOWCANVAS_OSS_ENDPOINT is required` 发生在模型请求之前。本地参考图必须先由 Go 后端上传 OSS 并获得模型平台可访问的临时公网 URL，但直接启动的桌面程序没有得到 `FLOWCANVAS_OSS_ENDPOINT` 等 OSS 服务端配置，因此任务在素材准备阶段终止；画面上方图片是本地预览，不是本次生成结果。

不得把 mm-agent 本地配置文件中的长期 OSS AccessKey 明文复制进安装包。正式分发建议使用远程上传代理或 STS 临时、限前缀凭证；若只服务当前机器，可另做 DPAPI 加密的本机 OSS 配置管理。此安全配置改造不属于本轮纯布局修改，未伪造为已完成。

## 签署

- 功能验收：PASS
- 视觉验收：PASS
- 安装包发布验收：PASS
- `G:\tool-test\tool-plus` 现场目录替换：PENDING（旧版可见窗口仍在运行，等待用户保存并关闭后执行）
