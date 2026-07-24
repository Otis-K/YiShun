# Tool Plus 0.5.10 OSS 配置文件与参考图链路验收

## 结论

- Go 后端自动读取 `%APPDATA%\tool-plus\flowcanvas-oss.json`：PASS
- 本地图片上传 OSS、生成临时签名 URL、下载内容哈希一致：PASS
- 本地参考图提交 Nano Banana 并生成有效图片：PASS
- Tool Plus 0.5.10 安装包构建与内容检查：PASS

## 配置行为

读取优先级为：用户 JSON 配置文件中的非空字段 > `FLOWCANVAS_OSS_*` 环境变量兜底。配置文件包含 `endpoint`、`accessKeyId`、`accessKeySecret`、`bucket`、`prefix` 和 `signedUrlTtlSeconds`。前端、画布 JSON、localStorage、验收日志和安装包均不写入这些值。

本机配置文件已生成于：

`C:\Users\祺\AppData\Roaming\tool-plus\flowcanvas-oss.json`

验收只记录字段存在性，不记录密钥或签名 URL。

## 自动化与真实链路

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| Go 全量单元测试 | PASS | `go test ./...`，全部包通过 |
| 配置优先级与非法 JSON | PASS | `storage/aliyunoss/config_test.go` |
| OSS 真实上传 | PASS | 图片 87,711 字节；对象前缀正确；签名下载成功；下载 SHA-256 与源文件一致 |
| 文生图 | PASS | Nano Banana 完成任务，结果落盘且 Electron 可解码 |
| 本地参考图生图 | PASS | `uploadedAssets=1`，任务完成，结果落盘且 Electron 可解码 |
| Tool Plus 基础回归 | PASS | 114 项工具目录与基础输出回归通过 |
| 本地画布启动契约 | PASS | 版本 0.5.10、同窗画布、本地 Go 模型代理通过 |
| 打包内容检查 | PASS | 版本 0.5.10；22 个关键文件；14 个源码/包内文件哈希一致 |

脱敏端到端报告：

`G:\tool-plus-v2\tool-plsu-v2\tool-plus-back\work\real-image-acceptance.json`

## 交付物

- 安装包：`G:\tool-test\文档批量处理工具 Setup 0.5.10.exe`
- 安装包大小：226,791,704 字节
- 安装包 SHA-256：`E9A4F4AE5EEF4604C8919C3C5AFB636BE1A42C7A584351731260346B20AFF13E`
- Go 画布后端 SHA-256：`48E831FF9991884F160F11B049BD5B0B1249DB7251163C713E0FE7D340290ACE`

## 尚未执行的现场动作

`G:\tool-test\tool-plus` 中的旧版窗口仍处于运行状态，因此没有强制结束进程或覆盖正在使用的目录。关闭旧版窗口后，可以运行 0.5.10 安装包升级，或再执行目录原子替换。
