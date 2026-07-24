# Electron 接入 FlowCanvas

## 推荐方式：IIFE + CSS

将 `dist/flowcanvas.iife.js` 和 `dist/styles.css` 放到 Electron 应用的本地 `vendor/flowcanvas` 目录，renderer 通过普通 script 标签加载。该方式适合没有 React/Vite 打包链的 `file://` 页面，也正是 Tool Plus 当前技术栈需要的方式。

```js
const window = new BrowserWindow({
  show: false,
  webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  },
});

await window.loadFile(path.join(__dirname, 'canvas.html'));
```

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'">
<link rel="stylesheet" href="./vendor/flowcanvas/styles.css">
<main id="canvas"></main>
<script src="./vendor/flowcanvas/flowcanvas.iife.js"></script>
<script src="./canvas-adapter.js"></script>
```

```js
const sdk = new window.FlowCanvas.FlowCanvasSDK({
  container: '#canvas',
  nodeTypes: hostNodeDefinitions,
  runtime: electronRuntimeAdapter,
  services: {
    assets: electronAssetService,
    assistant: electronAssistantService,
    configuration: { onRequired: error => window.host.openSettings(error.requirements) },
  },
});
```

容器必须由宿主设置宽高。模型、令牌和路径不要暴露到 renderer；通过 preload 的 `contextBridge` 暴露最小 IPC 能力。

## 配置时机

不要在进入画布前强制检查模型配置。挂载、导入、编辑和保存均可离线完成；`runtime.execute` 在真正运行时检查配置，并抛 `RuntimeConfigurationRequiredError`。宿主的 `services.configuration.onRequired` 再打开设置页。

## 已验证条件

`demo/standalone/electron-main.cjs` 与 `e2e/packaging.spec.ts` 会真实启动 Electron 39，使用 `loadFile()` 验证：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- renderer 中 `require` / `process` 不存在
- IIFE 挂载、运行、销毁完整
- 无 CDN、动态模块或 eval

## Tool Plus 接入顺序

1. 复制已验收的 IIFE/CSS 到 `frontend/vendor/flowcanvas`。
2. 保留 Tool Plus 的 preload/IPC 安全边界。
3. 用 Tool Plus 现有任务 API 实现 `WorkflowRuntime`，不要使用 demo executor。
4. 把现有节点参数映射为 `NodeDefinition` 与自定义 Inspector。
5. 配置检查移到 `run()`，画布入口始终可进入。
6. 对任务创建、状态回传、取消、失败重试、结果落盘做前后端联调验收。
