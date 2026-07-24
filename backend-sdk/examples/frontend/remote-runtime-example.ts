/**
 * Minimal FlowCanvas front-end adapter sketch.
 *
 * The front-end SDK keeps editing/import/export local. This adapter sends the
 * exported graph to the Go backend SDK and streams execution events back into
 * the UI layer. It intentionally does not depend on Tool Plus.
 */

type RuntimeEvent = {
  type: string;
  runId: string;
  nodeId?: string;
  status?: string;
  progress?: number;
  message?: string;
  error?: string;
  output?: Record<string, unknown>;
};

export class FlowCanvasGoRuntime {
  constructor(private readonly baseURL = 'http://127.0.0.1:8787/api/flow') {}

  async validate(graph: unknown) {
    const response = await fetch(`${this.baseURL}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ graph }),
    });
    return response.json();
  }

  async run(graph: unknown, onEvent: (event: RuntimeEvent) => void) {
    const start = await fetch(`${this.baseURL}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ graph, options: { stopOnError: true } }),
    });
    if (!start.ok) throw new Error(await start.text());
    const { runId } = await start.json();
    const events = new EventSource(`${this.baseURL}/runs/${runId}/events`);
    events.onmessage = message => onEvent(JSON.parse(message.data));
    events.addEventListener('node.progress', message => onEvent(JSON.parse((message as MessageEvent).data)));
    events.addEventListener('node.succeeded', message => onEvent(JSON.parse((message as MessageEvent).data)));
    events.addEventListener('node.failed', message => onEvent(JSON.parse((message as MessageEvent).data)));
    events.addEventListener('run.completed', message => {
      onEvent(JSON.parse((message as MessageEvent).data));
      events.close();
    });
    events.addEventListener('run.failed', message => {
      onEvent(JSON.parse((message as MessageEvent).data));
      events.close();
    });
    events.addEventListener('run.cancelled', message => {
      onEvent(JSON.parse((message as MessageEvent).data));
      events.close();
    });
    return { runId, close: () => events.close() };
  }

  async cancel(runId: string) {
    await fetch(`${this.baseURL}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
  }
}
