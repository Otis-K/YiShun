# 应用数据迁移与自定义存储验收（0.5.12）

验收日期：2026-07-18

## 实现范围

- 首次运行默认把旧 `%APPDATA%\tool-plus` 持久数据迁移到 `G:\tool-plus-data`。
- Electron 在创建窗口、数据库、画布和配置服务之前调用 `app.setPath('userData', ...)`，保证后续读写统一落到新目录。
- 设置页提供“应用数据存储”路径输入和目录选择；保存新位置后，下次启动自动迁移。
- 注册表 `HKCU\Software\ToolPlus` 只保存当前/上一个目录指针，不保存画布内容或密钥。
- 迁移范围包括画布 Local Storage、Session Storage、生成素材、任务记录、设置、模型/OSS 配置及数据库；不迁移可重建缓存。

## 自动验收

命令：`npm run verify:data-root`

结果：PASS。

覆盖项：

1. 图数据 LevelDB、生成素材、设置和数据库复制完整。
2. 缓存目录不迁移。
3. 迁移标记生成。
4. 主进程在启动早期切换 `userData`。
5. 主进程 IPC、preload API、设置页控件和保存逻辑均存在。

## 真实迁移验收

- 源目录：`C:\Users\祺\AppData\Roaming\tool-plus`
- 生效目录：`G:\tool-plus-data`
- 注册表 `DataRoot`：`G:\tool-plus-data`
- `canvas-assets`：源 13 个文件，目标 13 个文件。
- `settings.json`：SHA-256 一致。
- `flowcanvas-oss.json`：SHA-256 一致。
- `tool-plus.db`：SHA-256 一致。
- Local Storage LevelDB：源文件已复制；新版从 G 盘启动后在目标目录生成新的运行日志，证明实际读写目录已切换。

结论：真实 C→G 迁移通过，历史画布与生成素材没有丢失；后续数据默认写入 G 盘，并支持用户自定义位置。

说明：为避免在安装/升级验证前不可逆删除用户数据，旧 C 盘目录暂时作为备份保留；它已不再是 0.5.12 的活动数据目录。

## 回归与打包验收

- `npm run verify:release-source`：PASS。
- 114 项工具目录与处理回归：PASS。
- 画布 1200 节点压力、DAG、撤销重做、取消、重启持久化：PASS（本轮 753 ms）。
- 30 轮提示词连续输入：PASS，焦点丢失 0 次。
- 模型配置隔离与加密：PASS。
- 真实后端 + TaskManager + WorkflowManager + SQLite 两步任务流：PASS。
- `npm run verify:packaged`：PASS，版本 0.5.12，23 个打包文件检查通过。
- `release\win-unpacked\文档批量处理工具.exe` 实际启动：PASS，4 个 Electron 进程正常创建，活动 `DataRoot` 为 `G:\tool-plus-data`。

交付安装器 SHA-256：`5478482C8803B181F56715004456616CEF1988E24A0F506876A85526B9AE851F`。
