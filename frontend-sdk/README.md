# FlowCanvas SDK

FlowCanvas 是可嵌入 Web 与 Electron 的前端无限画布/DAG SDK，面向漫剧、AI 视频、素材编排和多模态工作台。它包含图数据模型、节点与端口系统、交互画布、命令历史、严格 JSON 导入导出、DAG 校验、运行时适配器、插件与宿主服务接口。

SDK 可以在没有模型配置时先挂载、编辑、保存和导入画布；只有真正执行时，宿主运行时才需要检查账号、模型和凭据。生产任务的鉴权、资源限制、内容策略和权威校验仍应由后端负责。

> `builtinNodeDefinitions` 是确定性的演示预设，只用延时和内存对象模拟图片、视频、音频与合成状态。它不会调用真实 AI 模型，也不会生成媒体文件。SDK 默认不注册这些节点；demo 必须显式设置 `includeBuiltinNodes: true`。

## Go 后端 Runtime

SDK 已内置 `GoBackendWorkflowRuntime`，可以直接接入独立的 `FlowCanvas-Backend-SDK`：

```ts
import { CanvasEngine, GoBackendWorkflowRuntime, builtinNodeDefinitions } from '@flowcanvas/sdk';

const runtime = new GoBackendWorkflowRuntime({
  baseURL: 'http://127.0.0.1:8787/api/flow',
});

const engine = new CanvasEngine({ graph, runtime });
for (const definition of builtinNodeDefinitions) engine.registerNodeType(definition);

const result = await engine.run({ useCache: false, stopOnError: true });
```

真实接入验收见 `docs/GO_BACKEND_RUNTIME.md` 和 `scripts/verify-go-backend-runtime.mjs`。

## 安装与最小接入

```bash
pnpm add @flowcanvas/sdk react react-dom
```

```html
<div id="canvas" style="width:100vw;height:100vh"></div>
```

```ts
import { FlowCanvasSDK } from '@flowcanvas/sdk';
import '@flowcanvas/sdk/styles.css';

const sdk = new FlowCanvasSDK({
  container: '#canvas',
  theme: 'dark',
  nodeTypes: [/* 生产节点定义 */],
  autosave: async (graph, { revision, signal }) => {
    await saveWorkflow({ graph, revision, signal });
  },
});

sdk.on('run:end', result => console.log(result.runId, result.status));
```

宿主必须给挂载容器明确的宽高。SDK 的 CSS 全部限制在 `.fc-sdk` 下，不修改宿主的 `html/body/#root`。

## 公开能力

| 能力 | API |
| --- | --- |
| 生命周期 | `mount`、`unmount`、`destroy` |
| 图数据 | `import`、`export`、`getGraph`、`validate` |
| 编辑 | `addNode`、`addEdge`、`undo`、`redo`、复制/粘贴快捷键 |
| 执行 | `run`、`cancel`、`RuntimeConfigurationRequiredError` |
| 扩展 | `registerNodeType`、`registerNodeRenderer`、`registerInspectorRenderer`、`use`、`unuse` |
| 宿主集成 | `services.assets`、`services.assistant`、`services.configuration` |
| 状态 | `setTheme`、`setReadOnly`、`on(event, listener)` |
| 持久化 | 串行、合并、可中止的 `autosave`；`flushAutosave` 明确返回状态并在未落盘时抛错 |

`readOnly` 会阻止图内容写入、导入、拖动、连线和历史修改；选择、平移、缩放、校验以及显式运行仍可使用。`getGraph()` 返回隔离副本，`getGraphSnapshot()` 返回运行时强制深只读的稳定视图。

## 自定义节点与真实运行时

```ts
import type { NodeDefinition, WorkflowRuntime } from '@flowcanvas/sdk';

const storyboard: NodeDefinition = {
  type: 'storyboard',
  title: '分镜规划',
  category: '创作',
  inputs: [{ id: 'text', label: '脚本', dataType: 'text', required: true }],
  outputs: [{ id: 'shots', label: '分镜', dataType: 'json' }],
  createData: () => ({ title: '分镜规划', retryCount: 1, cache: true }),
};

const runtime: WorkflowRuntime = {
  async execute(graph, _registry, options) {
    const response = await fetch('/api/workflows/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ graph, runId: options.runId }),
      signal: options.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    // result.runId 必须等于 options.runId。
    return result;
  },
};

new FlowCanvasSDK({ container: '#canvas', nodeTypes: [storyboard], runtime });
```

内置 `LocalWorkflowRuntime` 适合本地工具、原型和轻量执行，支持拓扑调度、端口传值、分支输入隔离、取消、有限重试及有界 LRU 缓存。生产 AI 任务通常应替换为 HTTP/IPC/队列适配器。

运行时缺少配置时，应抛出类型化错误；画布无需因此阻止进入：

```ts
import { RuntimeConfigurationRequiredError } from '@flowcanvas/sdk';

throw new RuntimeConfigurationRequiredError('请先选择视频模型', ['videoModel']);

const sdk = new FlowCanvasSDK({
  services: {
    configuration: {
      onRequired: error => openSettings(error.requirements),
    },
  },
});
```

## 插件、渲染器与服务

插件通过稳定 `id` 安装，销毁时按逆序清理；一个插件清理失败不会阻止其他插件和 SDK 核心资源释放。自定义节点/Inspector 渲染器收到深只读节点，异常会被局部 ErrorBoundary 隔离并发送 `error` 事件。

```ts
const plugin = {
  id: 'my.video.nodes',
  install({ sdk }) {
    const unregister = sdk.registerNodeType(storyboard);
    return () => unregister();
  },
};

sdk.use(plugin);
```

素材选择、AI 助手和配置页面都由宿主注入；没有服务时，SDK 不展示或模拟对应能力。Electron 可在服务内调用 `contextBridge` 暴露的 IPC API，浏览器可调用 HTTP API。

## JSON、迁移和安全边界

- `GraphDocument.schemaVersion` 当前为 `1`；旧版本通过相邻迁移链升级。
- 可传实例级 `GraphMigrationRegistry`，避免插件迁移污染其他画布实例。
- 节点 `data`、边 `data` 和 `metadata` 必须是纯 JSON 值；Date、BigInt、函数、undefined、循环引用会在写入/导出边界被拒绝，不会静默丢数据。
- 坐标、尺寸、缩放、进度、重试和运行状态均在运行时校验，不能依赖 TypeScript 或 UI 表单。
- 前端校验用于即时反馈；后端仍必须重新校验权限、额度、文件归属、节点白名单、模型参数、DAG 和执行计划。

## Electron / script 标签接入

构建产物同时包含 ESM、CJS、类型、CSS 和无外部依赖的 IIFE：

```html
<link rel="stylesheet" href="./vendor/flowcanvas/styles.css">
<div id="canvas"></div>
<script src="./vendor/flowcanvas/flowcanvas.iife.js"></script>
<script>
  const sdk = new window.FlowCanvas.FlowCanvasSDK({ container: '#canvas' });
</script>
```

IIFE 不使用 `require`、动态 `import`、CDN 或 `eval`，可由 Electron `loadFile()` 加载，并已在 `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true` 下实测。完整示例见 [Electron 接入文档](docs/ELECTRON_INTEGRATION.md) 和 `demo/standalone`。

## 开发与真实验收

开发环境建议 Node `20.19+` 或 `22.12+`：

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm test:package
pnpm test:e2e
```

测试覆盖核心/运行时/UI、严格序列化、插件、自动保存、2.5 万节点拓扑与空间索引、5,000 节点浏览器编辑、真实端口拖线、拖动、多选复制、取消、多实例、移动布局、实际 tgz 的 ESM/CJS/TypeScript/IIFE 消费，以及沙箱 Electron `file://` 挂载/执行/销毁。

这些执行测试验证的是 SDK 调度与集成闭环，不代表真实 AI 模型生成已验收。当前验收记录见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。
