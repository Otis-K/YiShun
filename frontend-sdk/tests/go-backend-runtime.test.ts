import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { GoBackendWorkflowRuntime, NodeRegistry, type GraphDocument } from '../src';

const graph: GraphDocument = {
  schemaVersion: 1,
  id: 'frontend-to-go',
  name: 'Frontend to Go',
  nodes: [
    { id: 'text-1', type: 'prompt', position: { x: 0, y: 0 }, data: { title: '文本', prompt: '故事' } },
    { id: 'image-1', type: 'image', position: { x: 320, y: 0 }, data: { title: '图片' } },
  ],
  edges: [
    { id: 'edge-1', source: 'text-1', sourcePort: 'text', target: 'image-1', targetPort: 'prompt' },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  metadata: {},
};

const registry = new NodeRegistry();
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  servers.length = 0;
});

const listen = async (
  handler: http.RequestListener,
): Promise<{ server: http.Server; baseURL: string }> => {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  return { server, baseURL: `http://127.0.0.1:${address.port}/api/flow` };
};

const readBody = async (request: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const json = (response: http.ServerResponse, status: number, value: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

const sse = (type: string, value: unknown): string => `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;

describe('GoBackendWorkflowRuntime', () => {
  it('validates with Go backend, runs graph, consumes SSE, and returns normalized result', async () => {
    let validated = false;
    const { baseURL } = await listen(async (request, response) => {
      if (request.url === '/api/flow/validate') {
        validated = true;
        expect(JSON.parse(await readBody(request)).graph.id).toBe(graph.id);
        json(response, 200, { valid: true, issues: [] });
        return;
      }
      if (request.url === '/api/flow/run') {
        const body = JSON.parse(await readBody(request));
        expect(body.graph.id).toBe(graph.id);
        json(response, 202, { runId: body.options.runId, status: 'running', events: `/api/flow/runs/${body.options.runId}/events` });
        return;
      }
      if (request.url?.endsWith('/events')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(sse('node.running', { type: 'node.running', runId: 'run-1', nodeId: 'text-1', status: 'running', progress: 0.1, message: '开始', timestamp: new Date().toISOString() }));
        response.write(sse('node.progress', { type: 'node.progress', runId: 'run-1', nodeId: 'text-1', status: 'running', progress: 0.5, message: '处理中', timestamp: new Date().toISOString() }));
        response.write(sse('node.succeeded', { type: 'node.succeeded', runId: 'run-1', nodeId: 'text-1', status: 'succeeded', progress: 1, timestamp: new Date().toISOString() }));
        response.write(sse('run.completed', { type: 'run.completed', runId: 'run-1', status: 'succeeded', timestamp: new Date().toISOString() }));
        response.end();
        return;
      }
      if (request.url === '/api/flow/runs/run-1') {
        const now = new Date().toISOString();
        json(response, 200, {
          runId: 'run-1',
          completed: true,
          eventCount: 4,
          result: {
            runId: 'run-1',
            status: 'succeeded',
            startedAt: now,
            endedAt: now,
            nodeStates: {
              'text-1': { nodeId: 'text-1', status: 'succeeded', progress: 1, attempts: 1, startedAt: now, endedAt: now },
              'image-1': { nodeId: 'image-1', status: 'succeeded', progress: 1, attempts: 1, startedAt: now, endedAt: now },
            },
            outputs: {
              'text-1': { text: '故事' },
              'image-1': { image: { kind: 'image', prompt: '故事' } },
            },
          },
        });
        return;
      }
      json(response, 404, { error: request.url });
    });

    const runtime = new GoBackendWorkflowRuntime({ baseURL });
    const states: string[] = [];
    const result = await runtime.execute(graph, registry, {
      runId: 'run-1',
      signal: new AbortController().signal,
      onNodeState: state => states.push(`${state.nodeId}:${state.status}:${state.progress}`),
    });

    expect(validated).toBe(true);
    expect(states).toContain('text-1:running:0.5');
    expect(states).toContain('text-1:success:1');
    expect(result).toMatchObject({
      runId: 'run-1',
      status: 'success',
      outputs: { 'text-1': { text: '故事' } },
    });
    expect(result.nodeStates['image-1'].status).toBe('success');
  });

  it('throws GraphValidationError when Go backend rejects the graph', async () => {
    const { baseURL } = await listen(async (request, response) => {
      if (request.url === '/api/flow/validate') {
        await readBody(request);
        json(response, 200, {
          valid: false,
          issues: [{ code: 'MISSING_SOURCE_PORT', severity: 'error', message: '源端口不存在', edgeId: 'edge-1' }],
        });
        return;
      }
      json(response, 500, { error: 'run should not be called' });
    });

    const runtime = new GoBackendWorkflowRuntime({ baseURL });
    await expect(runtime.execute(graph, registry, {
      runId: 'run-validation',
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ name: 'GraphValidationError' });
  });

  it('calls Go cancel endpoint when the front-end abort signal fires', async () => {
    let cancelledRunId = '';
    const { baseURL } = await listen(async (request, response) => {
      if (request.url === '/api/flow/validate') {
        await readBody(request);
        json(response, 200, { valid: true, issues: [] });
        return;
      }
      if (request.url === '/api/flow/run') {
        const body = JSON.parse(await readBody(request));
        json(response, 202, { runId: body.options.runId, status: 'running', events: `/api/flow/runs/${body.options.runId}/events` });
        return;
      }
      if (request.url === '/api/flow/cancel') {
        const body = JSON.parse(await readBody(request));
        cancelledRunId = body.runId;
        json(response, 200, { ok: true });
        return;
      }
      if (request.url?.endsWith('/events')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(sse('node.running', { type: 'node.running', runId: 'run-cancel', nodeId: 'text-1', status: 'running', progress: 0.1, timestamp: new Date().toISOString() }));
        return;
      }
      json(response, 404, { error: request.url });
    });

    const runtime = new GoBackendWorkflowRuntime({ baseURL });
    const controller = new AbortController();
    const pending = runtime.execute(graph, registry, {
      runId: 'run-cancel',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(cancelledRunId).toBe('run-cancel');
  });
});
