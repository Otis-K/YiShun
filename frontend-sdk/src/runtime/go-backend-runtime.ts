import { GraphValidationError } from '../core/validation';
import type {
  GraphDocument,
  NodeRunStatus,
  RuntimeNodeState,
  WorkflowRunResult,
} from '../core/types';
import type { NodeRegistry } from '../core/registry';
import type { RuntimeExecutionOptions, WorkflowRuntime } from './local-runtime';

export interface GoBackendWorkflowRuntimeOptions {
  /** Base URL of the Go backend transport, for example http://127.0.0.1:8787/api/flow. */
  baseURL: string;
  /** Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Also call /validate before /run. Defaults to true so backend validation is real. */
  validateBeforeRun?: boolean;
  /** Milliseconds before plain HTTP requests time out. SSE listens until terminal event or AbortSignal. */
  requestTimeoutMs?: number;
}

interface BackendValidationResult {
  valid: boolean;
  issues: Array<{
    code: string;
    severity: 'error' | 'warning';
    message: string;
    nodeId?: string;
    edgeId?: string;
    portId?: string;
    details?: Record<string, unknown>;
  }>;
}

interface BackendRunStart {
  runId: string;
  status: string;
  events?: string;
}

interface BackendEvent {
  type: string;
  runId?: string;
  nodeId?: string;
  nodeType?: string;
  status?: string;
  progress?: number;
  message?: string;
  error?: string;
  output?: Record<string, unknown>;
  timestamp?: string;
  sequence?: number;
}

interface BackendRunResponse {
  runId: string;
  completed: boolean;
  eventCount: number;
  result?: BackendRunResult | null;
}

interface BackendRunResult {
  runId: string;
  status: string;
  nodeStates: Record<string, BackendNodeState>;
  outputs: Record<string, Record<string, unknown>>;
  startedAt: string;
  endedAt: string;
  error?: string;
}

interface BackendNodeState {
  nodeId: string;
  nodeType?: string;
  status: string;
  progress: number;
  message?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  attempts: number;
}

const terminalEvents = new Set(['run.completed', 'run.failed', 'run.cancelled']);

const statusMap = new Map<string, NodeRunStatus>([
  ['idle', 'idle'],
  ['queued', 'queued'],
  ['running', 'running'],
  ['success', 'success'],
  ['succeeded', 'success'],
  ['error', 'error'],
  ['failed', 'error'],
  ['cancelled', 'cancelled'],
]);

const runStatusMap = new Map<string, WorkflowRunResult['status']>([
  ['success', 'success'],
  ['succeeded', 'success'],
  ['completed', 'success'],
  ['error', 'error'],
  ['failed', 'error'],
  ['cancelled', 'cancelled'],
]);

const normalizeBaseURL = (input: string): string => {
  const value = input.trim().replace(/\/+$/, '');
  if (!value) throw new Error('Go backend runtime baseURL is required.');
  return value;
};

const toTimestamp = (value: string | undefined, fallback = Date.now()): number => {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFrontendStatus = (status: string | undefined): NodeRunStatus => {
  const mapped = statusMap.get(String(status ?? '').toLowerCase());
  if (!mapped) throw new TypeError(`Unknown Go backend node status: ${String(status)}.`);
  return mapped;
};

const toFrontendRunStatus = (status: string | undefined): WorkflowRunResult['status'] => {
  const mapped = runStatusMap.get(String(status ?? '').toLowerCase());
  if (!mapped) throw new TypeError(`Unknown Go backend run status: ${String(status)}.`);
  return mapped;
};

const normalizeNodeState = (state: BackendNodeState, fallbackTime: number): RuntimeNodeState => ({
  nodeId: state.nodeId,
  status: toFrontendStatus(state.status),
  progress: Number.isFinite(state.progress) ? Math.min(1, Math.max(0, state.progress)) : 0,
  attempts: Number.isSafeInteger(state.attempts) && state.attempts >= 0 ? state.attempts : 0,
  message: typeof state.message === 'string' ? state.message : undefined,
  error: typeof state.error === 'string' ? state.error : undefined,
  startedAt: toTimestamp(state.startedAt, fallbackTime),
  endedAt: state.endedAt ? toTimestamp(state.endedAt, fallbackTime) : undefined,
});

const validationToFrontend = (result: BackendValidationResult) => ({
  valid: result.valid,
  issues: result.issues.map(issue => ({
    ...issue,
    code: issue.code as never,
  })),
});

class HTTPError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
    this.name = 'HTTPError';
  }
}

export class GoBackendWorkflowRuntime implements WorkflowRuntime {
  private readonly baseURL: string;
  private readonly fetchImpl: typeof fetch;
  private readonly validateBeforeRun: boolean;
  private readonly requestTimeoutMs: number;

  constructor(options: GoBackendWorkflowRuntimeOptions) {
    this.baseURL = normalizeBaseURL(options.baseURL);
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('GoBackendWorkflowRuntime requires fetch.');
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch;
    this.validateBeforeRun = options.validateBeforeRun ?? true;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
  }

  async validate(graph: GraphDocument): Promise<BackendValidationResult> {
    return this.requestJSON<BackendValidationResult>('validate', {
      method: 'POST',
      body: JSON.stringify({ graph }),
    });
  }

  async execute(
    graph: GraphDocument,
    _registry: NodeRegistry,
    options: RuntimeExecutionOptions,
  ): Promise<WorkflowRunResult> {
    if (this.validateBeforeRun) {
      const validation = await this.validate(graph);
      if (!validation.valid) throw new GraphValidationError(validationToFrontend(validation));
    }

    const start = await this.requestJSON<BackendRunStart>('run', {
      method: 'POST',
      body: JSON.stringify({
        graph,
        options: {
          runId: options.runId,
          stopOnError: options.stopOnError ?? true,
        },
      }),
    });
    if (start.runId !== options.runId) {
      throw new Error(`Go backend returned an unexpected runId: ${String(start.runId)}.`);
    }

    const cancelOnAbort = () => {
      void this.cancel(start.runId).catch(() => {
        // The engine treats the caller's AbortSignal as authoritative. The
        // best-effort HTTP cancel may race with page unloads, dev-server stops,
        // or test process cleanup, so a rejected side-channel cancel must not
        // become an unhandled rejection.
      });
    };
    if (options.signal.aborted) {
      cancelOnAbort();
      throw new DOMException('Workflow execution was cancelled.', 'AbortError');
    }
    options.signal.addEventListener('abort', cancelOnAbort, { once: true });
    try {
      await this.consumeEvents(start.events ?? `/runs/${start.runId}/events`, options);
      const snapshot = await this.requestJSON<BackendRunResponse>(`runs/${encodeURIComponent(start.runId)}`, {
        method: 'GET',
      });
      if (!snapshot.result) throw new Error(`Go backend run ${start.runId} finished without a result.`);
      return this.normalizeRunResult(snapshot.result, graph, options.runId);
    } finally {
      options.signal.removeEventListener('abort', cancelOnAbort);
    }
  }

  async cancel(runId: string): Promise<void> {
    await this.requestJSON('cancel', {
      method: 'POST',
      body: JSON.stringify({ runId }),
    });
  }

  private async consumeEvents(path: string, options: RuntimeExecutionOptions): Promise<void> {
    const response = await this.fetchImpl(this.resolve(path), {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
      signal: options.signal,
    });
    if (!response.ok) throw await this.responseError(response);
    if (!response.body) throw new Error('Go backend SSE response has no body.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const terminal = this.consumeSSEBuffer(buffer, options);
        buffer = terminal.remaining;
        if (terminal.done) return;
      }
      buffer += decoder.decode();
      this.consumeSSEBuffer(buffer, options);
    } catch (cause) {
      if (options.signal.aborted) throw new DOMException('Workflow execution was cancelled.', 'AbortError');
      throw cause;
    } finally {
      reader.releaseLock();
    }
  }

  private consumeSSEBuffer(
    input: string,
    options: RuntimeExecutionOptions,
  ): { remaining: string; done: boolean } {
    const normalized = input.replace(/\r\n/g, '\n');
    const parts = normalized.split('\n\n');
    const remaining = parts.pop() ?? '';
    for (const part of parts) {
      const event = parseSSEEvent(part);
      if (!event) continue;
      this.applyEvent(event, options);
      if (terminalEvents.has(event.type)) return { remaining, done: true };
    }
    return { remaining, done: false };
  }

  private applyEvent(event: BackendEvent, options: RuntimeExecutionOptions): void {
    if (!event.nodeId || !event.status) return;
    if (!event.type.startsWith('node.')) return;
    options.onNodeState?.({
      nodeId: event.nodeId,
      status: toFrontendStatus(event.status),
      progress: Number.isFinite(event.progress) ? Math.min(1, Math.max(0, event.progress ?? 0)) : 0,
      attempts: 0,
      message: event.message,
      error: event.error,
      startedAt: toTimestamp(event.timestamp),
      endedAt: terminalEvents.has(event.type) ? toTimestamp(event.timestamp) : undefined,
    });
  }

  private normalizeRunResult(
    result: BackendRunResult,
    graph: GraphDocument,
    expectedRunId: string,
  ): WorkflowRunResult {
    if (result.runId !== expectedRunId) {
      throw new Error(`Go backend snapshot returned an unexpected runId: ${String(result.runId)}.`);
    }
    const startedAt = toTimestamp(result.startedAt);
    const endedAt = toTimestamp(result.endedAt, startedAt);
    const nodeStates: Record<string, RuntimeNodeState> = Object.create(null) as Record<string, RuntimeNodeState>;
    for (const node of graph.nodes) {
      const backendState = result.nodeStates[node.id];
      nodeStates[node.id] = backendState
        ? normalizeNodeState(backendState, endedAt)
        : { nodeId: node.id, status: toFrontendRunStatus(result.status) === 'success' ? 'success' : 'error', progress: 0, attempts: 0, startedAt, endedAt };
    }
    return {
      runId: result.runId,
      status: toFrontendRunStatus(result.status),
      nodeStates,
      outputs: result.outputs ?? {},
      startedAt,
      endedAt,
      error: result.error,
    };
  }

  private async requestJSON<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.resolve(path), {
        ...init,
        headers: {
          accept: 'application/json',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
        signal: init.signal ?? controller.signal,
      });
      if (!response.ok) throw await this.responseError(response);
      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async responseError(response: Response): Promise<HTTPError> {
    let body: unknown;
    try {
      body = await response.clone().json();
    } catch {
      try {
        body = await response.text();
      } catch {
        body = undefined;
      }
    }
    const message = typeof body === 'object' && body && 'error' in body
      ? String((body as { error: unknown }).error)
      : `Go backend request failed with HTTP ${response.status}.`;
    return new HTTPError(response.status, message, body);
  }

  private resolve(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith('/')) return `${new URL(this.baseURL).origin}${path}`;
    return `${this.baseURL}/${path.replace(/^\/+/, '')}`;
  }
}

const parseSSEEvent = (chunk: string): BackendEvent | undefined => {
  const lines = chunk.split('\n');
  let eventType = 'message';
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) eventType = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return undefined;
  const parsed = JSON.parse(data.join('\n')) as BackendEvent;
  return { ...parsed, type: parsed.type || eventType };
};
