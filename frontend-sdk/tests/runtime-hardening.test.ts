import { describe, expect, it, vi } from 'vitest';
import { CanvasEngine } from '../src/core/engine';
import type { GraphDocument, NodeDefinition, RuntimeNodeState, WorkflowRunResult } from '../src/core/types';
import {
  LocalWorkflowRuntime,
  type RuntimeExecutionOptions,
  type WorkflowRuntime,
} from '../src/runtime/local-runtime';
import {
  isRuntimeConfigurationRequiredError,
  RuntimeConfigurationRequiredError,
} from '../src/runtime/errors';

const source: NodeDefinition = {
  type: 'source', title: 'Source', category: 'Test', inputs: [],
  outputs: [{ id: 'out', label: 'Out', dataType: 'text' }],
  createData: () => ({ title: 'Source' }),
  execute: ({ node }) => ({ out: node.data.value ?? 'ok' }),
};

const failing: NodeDefinition = {
  type: 'failing', title: 'Failing', category: 'Test', inputs: [],
  outputs: [{ id: 'out', label: 'Out', dataType: 'text' }],
  createData: () => ({ title: 'Failing' }),
  execute: () => { throw new Error('intentional failure'); },
};

const sinkExecutor = vi.fn(() => ({ out: 'sink' }));
const sink: NodeDefinition = {
  type: 'sink', title: 'Sink', category: 'Test',
  inputs: [{ id: 'in', label: 'In', dataType: 'text', required: true }],
  outputs: [{ id: 'out', label: 'Out', dataType: 'text' }],
  createData: () => ({ title: 'Sink' }),
  execute: sinkExecutor,
};

const failureGraph = (): GraphDocument => ({
  schemaVersion: 1,
  id: 'failure-graph',
  name: 'Failure graph',
  viewport: { x: 0, y: 0, zoom: 1 },
  metadata: {},
  nodes: [
    { id: 'fail', type: 'failing', position: { x: 0, y: 0 }, data: { title: 'Fail' } },
    { id: 'dependent', type: 'sink', position: { x: 100, y: 0 }, data: { title: 'Dependent' } },
    { id: 'independent', type: 'source', position: { x: 0, y: 100 }, data: { title: 'Independent' } },
  ],
  edges: [{ id: 'fail-dependent', source: 'fail', sourcePort: 'out', target: 'dependent', targetPort: 'in' }],
});

const createFailureEngine = (runtime?: WorkflowRuntime) => {
  const engine = new CanvasEngine({ graph: failureGraph(), runtime });
  [source, failing, sink].forEach(definition => engine.registerNodeType(definition));
  return engine;
};

describe('runtime hardening', () => {
  it('only recognizes structurally complete cross-realm configuration errors', () => {
    expect(isRuntimeConfigurationRequiredError({ code: 'CONFIGURATION_REQUIRED' })).toBe(false);
    expect(isRuntimeConfigurationRequiredError({
      code: 'CONFIGURATION_REQUIRED',
      message: 'Configure provider',
      requirements: ['provider'],
    })).toBe(true);
  });

  it('continues independent branches, reports an error result, and blocks failed dependencies', async () => {
    sinkExecutor.mockClear();
    const result = await createFailureEngine().run({ stopOnError: false, useCache: false });

    expect(result.status).toBe('error');
    expect(result.nodeStates.fail.status).toBe('error');
    expect(result.nodeStates.dependent.status).toBe('error');
    expect(result.nodeStates.dependent.error).toContain('Dependency failed');
    expect(result.nodeStates.independent.status).toBe('success');
    expect(sinkExecutor).not.toHaveBeenCalled();
    expect(Object.values(result.nodeStates).every(state => !['idle', 'queued', 'running'].includes(state.status)))
      .toBe(true);
  });

  it('leaves every node terminal when stop-on-error ends execution early', async () => {
    const result = await createFailureEngine().run({ stopOnError: true, useCache: false });
    expect(result.status).toBe('error');
    expect(Object.values(result.nodeStates).every(state => !['idle', 'queued', 'running'].includes(state.status)))
      .toBe(true);
  });

  it('bounds cache entries with LRU eviction', async () => {
    const runtime = new LocalWorkflowRuntime({ maxCacheEntries: 2 });
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'cache', name: 'Cache', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'source', type: 'source', position: { x: 0, y: 0 }, data: { title: 'Source', value: 0 } }],
    };
    const engine = new CanvasEngine({ graph, runtime });
    engine.registerNodeType(source);
    for (let value = 0; value < 8; value += 1) {
      engine.updateNodeData('source', { value });
      await engine.run({ useCache: true });
    }
    expect(runtime.cacheSize).toBe(2);
    runtime.clearCache();
    expect(runtime.cacheSize).toBe(0);
  });

  it('keeps independent runs alive concurrently and cancels only the selected node run', async () => {
    type PendingRun = {
      options: RuntimeExecutionOptions;
      resolve: (result: WorkflowRunResult) => void;
    };
    const pending: PendingRun[] = [];
    const controlled: WorkflowRuntime = {
      execute: (_graph, _registry, options) => new Promise(resolve => pending.push({ options, resolve })),
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'race', name: 'Race', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'source', type: 'source', position: { x: 0, y: 0 }, data: { title: 'Source' } }],
    };
    const engine = new CanvasEngine({ graph, runtime: controlled });
    engine.registerNodeType(source);
    const makeResult = (index: number, status: WorkflowRunResult['status']): WorkflowRunResult => ({
      runId: pending[index].options.runId,
      status,
      nodeStates: {},
      outputs: {},
      startedAt: 1,
      endedAt: 2,
    });

    const first = engine.run();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const second = engine.run();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].options.signal.aborted).toBe(false);
    expect(pending[1].options.signal.aborted).toBe(false);
    expect(engine.isRunning()).toBe(true);
    expect(engine.isNodeRunning('source')).toBe(true);

    const staleState: RuntimeNodeState = {
      nodeId: 'source', status: 'success', progress: 1, attempts: 1,
    };
    pending[0].options.onNodeState?.(staleState);
    expect(engine.getGraph().nodes[0].data.status).toBe('success');
    pending[0].resolve(makeResult(0, 'success'));
    await first;
    expect(engine.isRunning()).toBe(true);

    engine.cancelNode('source');
    expect(pending[1].options.signal.aborted).toBe(true);
    pending[1].resolve(makeResult(1, 'cancelled'));
    await second;
    expect(engine.isRunning()).toBe(false);
  });

  it('emits runtime errors, preserves configuration-required typing, and cleans up in finally', async () => {
    let calls = 0;
    const configurationError = new RuntimeConfigurationRequiredError(
      'Select an execution adapter before running.',
      ['adapter'],
    );
    const runtime: WorkflowRuntime = {
      execute: async (_graph, _registry, options) => {
        calls += 1;
        if (calls === 1) throw configurationError;
        return {
          runId: options.runId, status: 'success', nodeStates: {}, outputs: {}, startedAt: 1, endedAt: 2,
        };
      },
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'config', name: 'Config', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'source', type: 'source', position: { x: 0, y: 0 }, data: { title: 'Source' } }],
    };
    const engine = new CanvasEngine({ graph, runtime });
    engine.registerNodeType(source);
    const errors: Error[] = [];
    const started: string[] = [];
    const ended: string[] = [];
    engine.on('error', event => errors.push(event.error));
    engine.on('run:start', event => started.push(event.runId));
    engine.on('run:end', event => ended.push(event.runId));

    await expect(engine.run()).rejects.toBe(configurationError);
    expect(isRuntimeConfigurationRequiredError(errors[0])).toBe(true);
    expect(configurationError.code).toBe('CONFIGURATION_REQUIRED');
    expect(ended).toEqual(started);
    // The failed run's finally cleared its token, so a subsequent run completes normally.
    await expect(engine.run()).resolves.toMatchObject({ status: 'success' });
    expect(ended).toEqual(started);
  });

  it('applies authoritative final node states from a custom runtime without streaming callbacks', async () => {
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'final-state', name: 'Final state', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'source', type: 'source', position: { x: 0, y: 0 }, data: { title: 'Source' } }],
    };
    const runtime: WorkflowRuntime = {
      execute: async (_graph, _registry, options) => ({
        runId: options.runId,
        status: 'success',
        nodeStates: {
          source: { nodeId: 'source', status: 'success', progress: 1, attempts: 1 },
        },
        outputs: { source: { value: 'done' } },
        startedAt: 1,
        endedAt: 2,
      }),
    };
    const engine = new CanvasEngine({ graph, runtime });
    engine.registerNodeType(source);

    await expect(engine.run()).resolves.toMatchObject({ status: 'success' });
    expect(engine.getGraph().nodes[0].data).toMatchObject({ status: 'success', progress: 1 });
  });

  it('terminalizes streamed running nodes when a custom runtime is cancelled', async () => {
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'cancel-state', name: 'Cancel state', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'source', type: 'source', position: { x: 0, y: 0 }, data: { title: 'Source' } }],
    };
    const runtime: WorkflowRuntime = {
      execute: (_graph, _registry, options) => new Promise((_resolve, reject) => {
        options.onNodeState?.({
          nodeId: 'source', status: 'running', progress: 0.2, attempts: 1,
        });
        options.signal.addEventListener('abort', () => {
          reject(new DOMException('Cancelled', 'AbortError'));
        }, { once: true });
      }),
    };
    const engine = new CanvasEngine({ graph, runtime });
    engine.registerNodeType(source);

    const run = engine.run();
    await vi.waitFor(() => expect(engine.getGraph().nodes[0].data.status).toBe('running'));
    engine.cancel();
    await expect(run).resolves.toMatchObject({
      status: 'cancelled',
      nodeStates: { source: { status: 'cancelled', progress: 0.2 } },
    });
    expect(engine.getGraph().nodes[0].data).toMatchObject({ status: 'cancelled', progress: 0.2 });
  });

  it('isolates runtime results from the runtime and from mutating event listeners', async () => {
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'event-isolation', name: 'Event isolation', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'source', type: 'source', position: { x: 0, y: 0 }, data: { title: 'Source' } }],
    };
    let runtimeResult: WorkflowRunResult | undefined;
    const runtime: WorkflowRuntime = {
      execute: async (_graph, _registry, options) => {
        runtimeResult = {
          runId: options.runId, status: 'success', nodeStates: {}, outputs: { source: { value: 1 } }, startedAt: 1, endedAt: 2,
        };
        return runtimeResult;
      },
    };
    const engine = new CanvasEngine({ graph, runtime });
    engine.registerNodeType(source);
    const observed: string[] = [];
    engine.on('run:end', result => {
      result.status = 'error';
      (result.outputs.source as { value: number }).value = 99;
    });
    engine.on('run:end', result => observed.push(`${result.status}:${result.outputs.source.value}`));

    const returned = await engine.run();
    expect(observed).toEqual(['success:1']);
    expect(returned).toMatchObject({ status: 'success', outputs: { source: { value: 1 } } });
    if (!runtimeResult) throw new Error('runtime result missing');
    runtimeResult.status = 'error';
    expect(returned.status).toBe('success');
  });

  it('rejects a mismatched adapter runId but still balances run lifecycle events', async () => {
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'bad-run-id', name: 'Bad run id', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'source', type: 'source', position: { x: 0, y: 0 }, data: { title: 'Source' } }],
    };
    const runtime: WorkflowRuntime = {
      execute: async () => ({
        runId: 'wrong', status: 'success', nodeStates: {}, outputs: {}, startedAt: 1, endedAt: 2,
      }),
    };
    const engine = new CanvasEngine({ graph, runtime });
    engine.registerNodeType(source);
    const started: string[] = [];
    const ended: string[] = [];
    engine.on('run:start', event => started.push(event.runId));
    engine.on('run:end', event => ended.push(event.runId));
    await expect(engine.run()).rejects.toThrow(/runId/i);
    expect(ended).toEqual(started);
    expect(engine.isRunning()).toBe(false);
  });

  it('rejects malformed live adapter node state before it can corrupt graph data', async () => {
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'bad-state', name: 'Bad state', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'source', type: 'source', position: { x: 0, y: 0 }, data: { title: 'Source' } }],
    };
    const runtime: WorkflowRuntime = {
      execute: async (_graph, _registry, options) => {
        options.onNodeState?.({ nodeId: 'source', status: 'running', progress: Number.NaN, attempts: 1 });
        return { runId: options.runId, status: 'success', nodeStates: {}, outputs: {}, startedAt: 1, endedAt: 2 };
      },
    };
    const engine = new CanvasEngine({ graph, runtime });
    engine.registerNodeType(source);
    await expect(engine.run()).rejects.toThrow(/progress.*finite/i);
    expect(engine.getGraph().nodes[0].data).toMatchObject({ status: 'error', progress: 0 });
    expect(() => engine.exportGraph()).not.toThrow();
  });

  it('normalizes custom adapter abort rejection and late success to cancelled results', async () => {
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'adapter-cancel', name: 'Adapter cancel', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'source', type: 'source', position: { x: 0, y: 0 }, data: { title: 'Source' } }],
    };
    const rejecting: WorkflowRuntime = {
      execute: (_graph, _registry, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      }),
    };
    const rejectingEngine = new CanvasEngine({ graph, runtime: rejecting });
    rejectingEngine.registerNodeType(source);
    const rejectedRun = rejectingEngine.run();
    await vi.waitFor(() => expect(rejectingEngine.isRunning()).toBe(true));
    rejectingEngine.cancel();
    await expect(rejectedRun).resolves.toMatchObject({ status: 'cancelled' });

    let release!: () => void;
    const late: WorkflowRuntime = {
      execute: (_graph, _registry, options) => new Promise(resolve => {
        release = () => resolve({
          runId: options.runId, status: 'success', nodeStates: {}, outputs: {}, startedAt: 1, endedAt: 2,
        });
      }),
    };
    const lateEngine = new CanvasEngine({ graph, runtime: late });
    lateEngine.registerNodeType(source);
    const lateRun = lateEngine.run();
    await vi.waitFor(() => expect(lateEngine.isRunning()).toBe(true));
    lateEngine.cancel();
    release();
    await expect(lateRun).resolves.toMatchObject({ status: 'cancelled', outputs: {} });
  });

  it('preserves configuration-required errors thrown by a local node executor', async () => {
    let attempts = 0;
    const configurationError = new RuntimeConfigurationRequiredError(
      'Configure the host video provider before running.',
      ['videoProvider'],
    );
    const configurable: NodeDefinition = {
      type: 'configurable', title: 'Configurable', category: 'Test', inputs: [], outputs: [],
      createData: () => ({ title: 'Configurable' }),
      execute: () => {
        attempts += 1;
        throw configurationError;
      },
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'local-config', name: 'Local config',
      viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{
        id: 'configurable', type: 'configurable', position: { x: 0, y: 0 },
        data: { title: 'Configurable', retryCount: 3 },
      }],
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(configurable);

    await expect(engine.run({ stopOnError: false })).rejects.toBe(configurationError);
    expect(attempts).toBe(1);
    expect(engine.getGraph().nodes[0].data.status).toBe('error');
  });

  it('does not collide cache keys for distinct Date values from upstream nodes', async () => {
    let tick = 0;
    let downstreamCalls = 0;
    const dateSource: NodeDefinition = {
      type: 'date-source', title: 'Date source', category: 'Test', inputs: [],
      outputs: [{ id: 'date', label: 'Date', dataType: 'any' }],
      createData: () => ({ title: 'Date source', cache: false }),
      execute: () => ({ date: new Date(++tick) }),
    };
    const dateSink: NodeDefinition = {
      type: 'date-sink', title: 'Date sink', category: 'Test',
      inputs: [{ id: 'date', label: 'Date', dataType: 'any', required: true }],
      outputs: [{ id: 'stamp', label: 'Stamp', dataType: 'json' }],
      createData: () => ({ title: 'Date sink' }),
      execute: ({ inputs }) => {
        downstreamCalls += 1;
        return { stamp: (inputs.date as Date).getTime() };
      },
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'date-cache', name: 'Date cache', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {},
      nodes: [
        { id: 'source', type: 'date-source', position: { x: 0, y: 0 }, data: { title: 'Date source', cache: false } },
        { id: 'sink', type: 'date-sink', position: { x: 100, y: 0 }, data: { title: 'Date sink' } },
      ],
      edges: [{ id: 'date-edge', source: 'source', sourcePort: 'date', target: 'sink', targetPort: 'date' }],
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(dateSource);
    engine.registerNodeType(dateSink);

    const first = await engine.run({ useCache: true });
    const second = await engine.run({ useCache: true });
    expect(first.outputs.sink.stamp).toBe(1);
    expect(second.outputs.sink.stamp).toBe(2);
    expect(second.nodeStates.sink.cached).not.toBe(true);
    expect(downstreamCalls).toBe(2);
  });

  it('invalidates cache identity when a node definition is replaced', async () => {
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'definition-cache', name: 'Definition cache', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'versioned', type: 'versioned', position: { x: 0, y: 0 }, data: { title: 'Versioned' } }],
    };
    const engine = new CanvasEngine({ graph });
    const firstDefinition: NodeDefinition = {
      type: 'versioned', title: 'Versioned', category: 'Test', inputs: [], outputs: [],
      createData: () => ({ title: 'Versioned' }), execute: () => ({ value: 1 }),
    };
    const dispose = engine.registerNodeType(firstDefinition);
    expect((await engine.run({ useCache: true })).outputs.versioned.value).toBe(1);
    dispose();
    engine.registerNodeType({ ...firstDefinition, execute: () => ({ value: 2 }) });
    const second = await engine.run({ useCache: true });
    expect(second.outputs.versioned.value).toBe(2);
    expect(second.nodeStates.versioned.cached).not.toBe(true);
  });

  it('rejects invalid executor results and non-finite progress without leaking running states', async () => {
    const invalid: NodeDefinition = {
      type: 'invalid-result', title: 'Invalid result', category: 'Test', inputs: [], outputs: [],
      createData: () => ({ title: 'Invalid result' }),
      execute: ({ emitProgress }) => { emitProgress(Number.NaN); return null as never; },
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'invalid-result', name: 'Invalid result', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'invalid', type: 'invalid-result', position: { x: 0, y: 0 }, data: { title: 'Invalid result' } }],
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(invalid);
    const result = await engine.run();
    expect(result.status).toBe('error');
    expect(result.nodeStates.invalid.status).toBe('error');
    expect(result.nodeStates.invalid.error).toMatch(/finite/i);
  });

  it('isolates forked branch inputs from source outputs and sibling mutation', async () => {
    const objectSource: NodeDefinition = {
      type: 'object-source', title: 'Object source', category: 'Test', inputs: [],
      outputs: [{ id: 'value', label: 'Value', dataType: 'json' }],
      createData: () => ({ title: 'Object source' }), execute: () => ({ value: { x: 1 } }),
    };
    const mutator: NodeDefinition = {
      type: 'mutator', title: 'Mutator', category: 'Test',
      inputs: [{ id: 'value', label: 'Value', dataType: 'json', required: true }], outputs: [],
      createData: () => ({ title: 'Mutator' }),
      execute: ({ inputs }) => { (inputs.value as { x: number }).x = 99; return { seen: 99 }; },
    };
    const reader: NodeDefinition = {
      type: 'reader', title: 'Reader', category: 'Test',
      inputs: [{ id: 'value', label: 'Value', dataType: 'json', required: true }], outputs: [],
      createData: () => ({ title: 'Reader' }), execute: ({ inputs }) => ({ seen: (inputs.value as { x: number }).x }),
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'branch-isolation', name: 'Branch isolation', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {},
      nodes: [
        { id: 'source', type: 'object-source', position: { x: 0, y: 0 }, data: { title: 'Source' } },
        { id: 'mutator', type: 'mutator', position: { x: 100, y: 0 }, data: { title: 'Mutator' } },
        { id: 'reader', type: 'reader', position: { x: 100, y: 100 }, data: { title: 'Reader' } },
      ],
      edges: [
        { id: 'to-mutator', source: 'source', sourcePort: 'value', target: 'mutator', targetPort: 'value' },
        { id: 'to-reader', source: 'source', sourcePort: 'value', target: 'reader', targetPort: 'value' },
      ],
    };
    const engine = new CanvasEngine({ graph });
    [objectSource, mutator, reader].forEach(definition => engine.registerNodeType(definition));
    const result = await engine.run({ useCache: false });
    expect(result.outputs.source.value).toEqual({ x: 1 });
    expect(result.outputs.reader.seen).toBe(1);
  });

  it('caps hostile retryCount values at the configured runtime limit', async () => {
    let calls = 0;
    const retrying: NodeDefinition = {
      type: 'retry-cap', title: 'Retry cap', category: 'Test', inputs: [], outputs: [],
      createData: () => ({ title: 'Retry cap' }),
      execute: () => { calls += 1; throw new Error('always fails'); },
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'retry-cap', name: 'Retry cap', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'retry', type: 'retry-cap', position: { x: 0, y: 0 }, data: { title: 'Retry cap', retryCount: 1_000_000_000 } }],
    };
    const engine = new CanvasEngine({ graph, runtime: new LocalWorkflowRuntime({ maxRetries: 3 }) });
    engine.registerNodeType(retrying);
    const result = await engine.run({ useCache: false });
    expect(result.status).toBe('error');
    expect(result.nodeStates.retry.attempts).toBe(4);
    expect(calls).toBe(4);
  });

  it('preserves prototype-shaped node and port IDs through execution dictionaries', async () => {
    let received: unknown;
    const protoSource: NodeDefinition = {
      type: 'proto-source', title: 'Proto source', category: 'Test', inputs: [],
      outputs: [{ id: '__proto__', label: 'Value', dataType: 'text' }],
      createData: () => ({ title: 'Proto source' }),
      execute: () => Object.fromEntries([['__proto__', 'secret']]),
    };
    const protoSink: NodeDefinition = {
      type: 'proto-sink', title: 'Proto sink', category: 'Test',
      inputs: [{ id: '__proto__', label: 'Value', dataType: 'text', required: true }], outputs: [],
      createData: () => ({ title: 'Proto sink' }),
      execute: ({ inputs }) => {
        received = inputs.__proto__;
        return { accepted: true };
      },
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'prototype-ids', name: 'Prototype IDs', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {},
      nodes: [
        { id: '__proto__', type: 'proto-source', position: { x: 0, y: 0 }, data: { title: 'Source' } },
        { id: 'sink', type: 'proto-sink', position: { x: 200, y: 0 }, data: { title: 'Sink' } },
      ],
      edges: [{
        id: 'edge', source: '__proto__', sourcePort: '__proto__', target: 'sink', targetPort: '__proto__',
      }],
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(protoSource);
    engine.registerNodeType(protoSink);

    const result = await engine.run();
    expect(result.status).toBe('success');
    expect(Object.hasOwn(result.nodeStates, '__proto__')).toBe(true);
    expect(Object.hasOwn(result.outputs, '__proto__')).toBe(true);
    expect(Object.hasOwn(result.outputs.__proto__, '__proto__')).toBe(true);
    expect(received).toBe('secret');
    expect(engine.getGraph().nodes.find(node => node.id === '__proto__')?.data.status).toBe('success');
  });
});
