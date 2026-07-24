# Go Backend Runtime 接入说明

前端 SDK 已内置 `GoBackendWorkflowRuntime`，可直接连接 `FlowCanvas-Backend-SDK` 的 HTTP/SSE 服务。

## 启动 Go 后端

```powershell
cd G:\FlowCanvas-SDK\FlowCanvas-Backend-SDK
G:\DevEnv\go_1_24_13\bin\go.exe run ./examples/server -addr 127.0.0.1:8787
```

服务地址：

```text
http://127.0.0.1:8787/api/flow
```

## 前端 SDK 使用

```ts
import {
  CanvasEngine,
  GoBackendWorkflowRuntime,
  builtinNodeDefinitions,
} from '@flowcanvas/sdk';

const runtime = new GoBackendWorkflowRuntime({
  baseURL: 'http://127.0.0.1:8787/api/flow',
});

const engine = new CanvasEngine({ graph, runtime });
for (const definition of builtinNodeDefinitions) {
  engine.registerNodeType(definition);
}

engine.on('run:node', state => {
  // running / progress / success / error / cancelled
  console.log(state.nodeId, state.status, state.progress);
});

const result = await engine.run({ useCache: false, stopOnError: true });
```

## 真实链条

```text
CanvasEngine.run()
  -> GoBackendWorkflowRuntime.validate()
  -> POST /api/flow/validate
  -> POST /api/flow/run
  -> GET /api/flow/runs/{runId}/events 读取 SSE
  -> run:node 更新前端节点状态
  -> GET /api/flow/runs/{runId} 拉取最终 outputs
```

取消：

```text
CanvasEngine.cancel()
  -> AbortSignal
  -> POST /api/flow/cancel
  -> 前端 run result = cancelled
```

## 验收命令

```powershell
cd G:\FlowCanvas-SDK\FlowCanvas-SDK
pnpm test:go-backend
```

该命令会：

1. build 前端 SDK；
2. 启动真实 Go example server；
3. 用 `CanvasEngine + GoBackendWorkflowRuntime` 跑 `text -> image -> video`；
4. 校验 Go 后端 validate；
5. 校验 SSE 事件能更新前端 `run:node`；
6. 校验前端 cancel 能触发 Go cancel 并返回 cancelled。
