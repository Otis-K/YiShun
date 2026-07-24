import type { NodeRegistry } from '../core/registry';
import { analyzeTopology } from '../core/topology';
import { GraphValidationError, validateGraph } from '../core/validation';
import type {
  CanvasEdge,
  GraphDocument,
  RuntimeNodeState,
  RuntimeOptions,
  WorkflowRunResult,
} from '../core/types';
import { isRuntimeConfigurationRequiredError } from './errors';

export { RuntimeConfigurationRequiredError, isRuntimeConfigurationRequiredError } from './errors';

export interface RuntimeExecutionOptions extends RuntimeOptions {
  runId: string;
  signal: AbortSignal;
  onNodeState?: (state: RuntimeNodeState) => void;
}

export interface WorkflowRuntime {
  execute(
    graph: GraphDocument,
    registry: NodeRegistry,
    options: RuntimeExecutionOptions,
  ): Promise<WorkflowRunResult>;
  clearCache?(): void;
}

export interface LocalWorkflowRuntimeOptions {
  /** Maximum LRU entries. Set to zero to disable storage. */
  maxCacheEntries?: number;
  /** Hard cap for host-provided node retryCount values. Defaults to 3. */
  maxRetries?: number;
}

const abortError = () => new DOMException('Workflow execution was cancelled.', 'AbortError');

const runtimeDataKeys = new Set(['status', 'progress', 'runMessage', 'runError']);

const cacheableNodeData = (data: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
  Object.entries(data).filter(([key]) => !runtimeDataKeys.has(key)),
);

const hashValue = (value: unknown): string => {
  const seen = new WeakSet<object>();

  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : { $flowcanvas: 'number', value: String(input) };
    if (typeof input === 'undefined') return { $flowcanvas: 'undefined' };
    if (typeof input === 'bigint') return { $flowcanvas: 'bigint', value: input.toString() };
    if (typeof input !== 'object') throw new TypeError('Value is not deterministically cacheable.');
    if (seen.has(input)) throw new TypeError('Cannot cache workflow values containing circular references.');
    seen.add(input);

    if (input instanceof Date) {
      const result = { $flowcanvas: 'date', value: input.toISOString() };
      seen.delete(input);
      return result;
    }
    if (input instanceof ArrayBuffer) {
      const result = { $flowcanvas: 'array-buffer', value: Array.from(new Uint8Array(input)) };
      seen.delete(input);
      return result;
    }
    if (ArrayBuffer.isView(input)) {
      const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      const result = { $flowcanvas: input.constructor.name, value: Array.from(bytes) };
      seen.delete(input);
      return result;
    }
    if (input instanceof Map) {
      const entries = [...input.entries()].map(([key, nested]) => [normalize(key), normalize(nested)]);
      entries.sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
      seen.delete(input);
      return { $flowcanvas: 'map', value: entries };
    }
    if (input instanceof Set) {
      const values = [...input].map(normalize).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      seen.delete(input);
      return { $flowcanvas: 'set', value: values };
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      seen.delete(input);
      throw new TypeError('Blob and File values disable synchronous runtime caching.');
    }

    if (Array.isArray(input)) {
      const result = input.map(normalize);
      seen.delete(input);
      return result;
    }

    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      seen.delete(input);
      throw new TypeError(`Unsupported cache value type: ${input.constructor?.name ?? 'object'}.`);
    }
    const result = Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
    seen.delete(input);
    return result;
  };

  return JSON.stringify(normalize(value));
};

const tryHashValue = (value: unknown): string | undefined => {
  try {
    return hashValue(value);
  } catch {
    return undefined;
  }
};

export class LocalWorkflowRuntime implements WorkflowRuntime {
  private readonly cache = new Map<string, Record<string, unknown>>();
  private readonly maxCacheEntries: number;
  private readonly maxRetries: number;

  constructor(options: LocalWorkflowRuntimeOptions = {}) {
    const requested = options.maxCacheEntries ?? 256;
    if (!Number.isFinite(requested) || requested < 0) {
      throw new RangeError('maxCacheEntries must be a finite non-negative number.');
    }
    this.maxCacheEntries = Math.floor(requested);
    const maxRetries = options.maxRetries ?? 3;
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 100) {
      throw new RangeError('maxRetries must be a safe integer between 0 and 100.');
    }
    this.maxRetries = maxRetries;
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async execute(
    graph: GraphDocument,
    registry: NodeRegistry,
    options: RuntimeExecutionOptions,
  ): Promise<WorkflowRunResult> {
    const validation = validateGraph(graph, registry);
    if (!validation.valid) throw new GraphValidationError(validation);

    const { runId } = options;
    const startedAt = Date.now();
    // IDs are host data and may legally be names such as "__proto__".
    // Null-prototype dictionaries prevent those keys from invoking setters.
    const nodeStates: Record<string, RuntimeNodeState> = Object.create(null) as Record<string, RuntimeNodeState>;
    const outputs: Record<string, Record<string, unknown>> = Object.create(null) as Record<string, Record<string, unknown>>;
    const topology = analyzeTopology(graph);
    const nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
    const incomingByNode = new Map<string, CanvasEdge[]>();
    for (const node of graph.nodes) incomingByNode.set(node.id, []);
    for (const edge of graph.edges) incomingByNode.get(edge.target)?.push(edge);

    const notify = (state: RuntimeNodeState) => options.onNodeState?.({ ...state });
    for (const node of graph.nodes) {
      nodeStates[node.id] = { nodeId: node.id, status: 'queued', progress: 0, attempts: 0 };
      notify(nodeStates[node.id]);
    }

    const update = (nodeId: string, patch: Partial<RuntimeNodeState>) => {
      nodeStates[nodeId] = { ...nodeStates[nodeId], ...patch };
      notify(nodeStates[nodeId]);
    };
    const failures = new Map<string, Error>();

    try {
      for (const nodeId of topology.order) {
        if (options.signal.aborted) throw abortError();
        const node = nodeMap.get(nodeId)!;
        const definition = registry.require(node.type);
        const incoming = incomingByNode.get(nodeId) ?? [];
        const failedDependencies = [...new Set(
          incoming
            .map(edge => edge.source)
            .filter(sourceId => {
              const status = nodeStates[sourceId]?.status;
              return status === 'error';
            }),
        )];

        if (failedDependencies.length) {
          const error = new Error(`Dependency failed: ${failedDependencies.join(', ')}`);
          failures.set(nodeId, error);
          outputs[nodeId] = {};
          update(nodeId, {
            status: 'error',
            progress: 0,
            attempts: 0,
            startedAt: Date.now(),
            endedAt: Date.now(),
            error: error.message,
            message: '上游节点执行失败',
          });
          continue;
        }

        const inputs: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        for (const edge of incoming) {
          // Each consumer receives an isolated value. A mutating branch must
          // not change the source result or another branch's input.
          const value = structuredClone(outputs[edge.source]?.[edge.sourcePort]);
          const port = definition.inputs.find(input => input.id === edge.targetPort);
          if (port?.multiple) {
            const values = Array.isArray(inputs[edge.targetPort]) ? inputs[edge.targetPort] as unknown[] : [];
            inputs[edge.targetPort] = [...values, value];
          } else {
            inputs[edge.targetPort] = value;
          }
        }

        const cacheHash = tryHashValue({ data: cacheableNodeData(node.data), inputs });
        const cacheKey = cacheHash === undefined
          ? undefined
          : `${registry.revision}:${node.type}:${node.id}:${cacheHash}`;
        const forceRefresh = options.useCache === false || (options.refreshNodeIds ?? []).includes(nodeId);
        const cached = cacheKey && !forceRefresh && node.data.cache !== false
          ? this.readCache(cacheKey)
          : undefined;
        if (cached) {
          outputs[nodeId] = cached;
          const now = Date.now();
          update(nodeId, {
            status: 'success', progress: 1, attempts: 0, cached: true, startedAt: now, endedAt: now,
          });
          continue;
        }

        const requestedRetries = Number(node.data.retryCount ?? 0);
        const maxAttempts = Number.isFinite(requestedRetries)
          ? Math.min(this.maxRetries, Math.max(0, Math.floor(requestedRetries))) + 1
          : 1;
        let lastError: Error | undefined;
        update(nodeId, { status: 'running', progress: 0, startedAt: Date.now(), cached: false });

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (options.signal.aborted) throw abortError();
          update(nodeId, { attempts: attempt, message: attempt > 1 ? `第 ${attempt} 次尝试` : undefined });
          try {
            const result = definition.execute
              ? await definition.execute({
                  node,
                  inputs,
                  signal: options.signal,
                  forceRefresh,
                  emitProgress: (progress, message) => {
                    if (!Number.isFinite(progress)) throw new RangeError('Node progress must be a finite number.');
                    if (message !== undefined && typeof message !== 'string') throw new TypeError('Node progress message must be a string.');
                    if (!options.signal.aborted) {
                      update(nodeId, { progress: Math.min(1, Math.max(0, progress)), message });
                    }
                  },
                })
              : { output: Object.values(inputs)[0] ?? node.data };
            if (options.signal.aborted) throw abortError();
            if (!result || typeof result !== 'object' || Array.isArray(result)) {
              throw new TypeError(`Node executor "${node.type}" must return an object.`);
            }
            const isolatedResult = structuredClone(result);
            outputs[nodeId] = isolatedResult;
            if (cacheKey && node.data.cache !== false) this.writeCache(cacheKey, isolatedResult);
            update(nodeId, {
              status: 'success', progress: 1, endedAt: Date.now(), error: undefined, message: undefined,
            });
            lastError = undefined;
            break;
          } catch (cause) {
            if (options.signal.aborted) throw abortError();
            lastError = cause instanceof Error ? cause : new Error(String(cause));
            // Host prerequisites are not transient node failures. Retrying
            // would repeatedly open settings or recreate remote sessions.
            if (isRuntimeConfigurationRequiredError(lastError)) {
              failures.set(nodeId, lastError);
              outputs[nodeId] = {};
              update(nodeId, {
                status: 'error',
                endedAt: Date.now(),
                error: lastError.message,
              });
              throw lastError;
            }
          }
        }

        if (lastError) {
          failures.set(nodeId, lastError);
          update(nodeId, { status: 'error', endedAt: Date.now(), error: lastError.message });
          outputs[nodeId] = {};
          // Configuration is a host-level prerequisite, not a node failure that
          // can be retried or skipped. Preserve its typed error so Electron/web
          // hosts can open their own settings UI and then run again.
          if (isRuntimeConfigurationRequiredError(lastError)) throw lastError;
          if (options.stopOnError !== false) throw lastError;
        }
      }

      if (failures.size) {
        return {
          runId,
          status: 'error',
          nodeStates,
          outputs,
          startedAt,
          endedAt: Date.now(),
          error: [...failures].map(([id, error]) => `${id}: ${error.message}`).join('; '),
        };
      }
      return { runId, status: 'success', nodeStates, outputs, startedAt, endedAt: Date.now() };
    } catch (cause) {
      const cancelled = options.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError');
      if (cancelled) {
        for (const state of Object.values(nodeStates)) {
          if (state.status === 'queued' || state.status === 'running') {
            update(state.nodeId, { status: 'cancelled', endedAt: Date.now() });
          }
        }
      } else {
        for (const state of Object.values(nodeStates)) {
          if (state.status === 'queued') {
            update(state.nodeId, {
              status: 'error',
              endedAt: Date.now(),
              error: 'Skipped because workflow stopped after an error.',
            });
          }
        }
      }
      if (isRuntimeConfigurationRequiredError(cause)) throw cause;
      return {
        runId,
        status: cancelled ? 'cancelled' : 'error',
        nodeStates,
        outputs,
        startedAt,
        endedAt: Date.now(),
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  private readCache(key: string): Record<string, unknown> | undefined {
    const value = this.cache.get(key);
    if (!value) return undefined;
    // Refresh insertion order to implement LRU eviction.
    this.cache.delete(key);
    this.cache.set(key, value);
    return structuredClone(value);
  }

  private writeCache(key: string, value: Record<string, unknown>): void {
    if (this.maxCacheEntries === 0) return;
    this.cache.delete(key);
    this.cache.set(key, structuredClone(value));
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
