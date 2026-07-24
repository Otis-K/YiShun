import { describe, expect, it } from 'vitest';
import { builtinNodeDefinitions } from '../src/builtins';
import { CanvasEngine } from '../src/core/engine';
import type { GraphDocument, NodeDefinition } from '../src/core/types';
import { demoGraph } from '../demo/graph';

const createDemoEngine = () => {
  const engine = new CanvasEngine({ graph: structuredClone(demoGraph) });
  builtinNodeDefinitions.forEach(definition => engine.registerNodeType(definition));
  return engine;
};

describe('local workflow runtime', () => {
  it('passes outputs between ports and completes the graph', async () => {
    const engine = createDemoEngine();
    const result = await engine.run({ useCache: true });

    expect(result.status).toBe('success');
    expect(result.outputs.script.text).toContain('雨夜');
    expect(result.outputs.shot.video).toMatchObject({ kind: 'video' });
    expect(result.outputs.compose.output).toMatchObject({ kind: 'video', resolution: '1080p' });
    expect(Object.values(result.nodeStates).every(state => state.status === 'success')).toBe(true);
  });

  it('uses deterministic node cache on a second run', async () => {
    const engine = createDemoEngine();
    await engine.run({ useCache: true });
    const second = await engine.run({ useCache: true });
    expect(Object.values(second.nodeStates).every(state => state.cached)).toBe(true);
  });

  it('retries only the requested node and keeps completed upstream nodes cached', async () => {
    const calls = { source: 0, target: 0 };
    const source: NodeDefinition = {
      type: 'refresh-source', title: 'Source', category: 'Test', inputs: [], outputs: [{ id: 'image', label: 'Image', dataType: 'image' }],
      createData: () => ({ title: 'Source' }), execute: ({ forceRefresh }) => { calls.source += 1; expect(forceRefresh).toBe(false); return { image: { id: calls.source } }; },
    };
    const target: NodeDefinition = {
      type: 'refresh-target', title: 'Target', category: 'Test', inputs: [{ id: 'reference', label: 'Reference', dataType: 'image', multiple: true }], outputs: [{ id: 'image', label: 'Image', dataType: 'image' }],
      createData: () => ({ title: 'Target' }), execute: ({ forceRefresh }) => { calls.target += 1; expect(forceRefresh).toBe(true); return { image: { id: calls.target } }; },
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'target-refresh', name: 'Target refresh', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {},
      nodes: [
        { id: 'a', type: source.type, position: { x: 0, y: 0 }, data: source.createData() },
        { id: 'c', type: target.type, position: { x: 200, y: 0 }, data: target.createData() },
      ],
      edges: [{ id: 'a-c', source: 'a', sourcePort: 'image', target: 'c', targetPort: 'reference' }],
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(source); engine.registerNodeType(target);
    await engine.runNode('c');
    await engine.runNode('c');
    expect(calls).toEqual({ source: 1, target: 2 });
  });

  it('uses the same identifier for run lifecycle events and nested cache values', async () => {
    const engine = createDemoEngine();
    const started: string[] = [];
    engine.on('run:start', event => started.push(event.runId));

    const first = await engine.run({ useCache: true });
    const graph = engine.getGraph();
    const character = graph.nodes.find(node => node.id === 'character')!;
    engine.updateNodeData('character', {
      settings: { quality: 'high', camera: { lens: 50, aperture: 1.8 } },
    });
    await engine.run({ useCache: true });
    engine.updateNodeData('character', {
      settings: { camera: { aperture: 1.8, lens: 50 }, quality: 'high' },
    });
    const reordered = await engine.run({ useCache: true });

    expect(started[0]).toBe(first.runId);
    expect(started).toHaveLength(3);
    expect(reordered.nodeStates.character.cached).toBe(true);
    expect(character).toBeDefined();
  });

  it('retries failed executors and supports cancellation', async () => {
    let attempts = 0;
    const flaky: NodeDefinition = {
      type: 'flaky', title: 'Flaky', category: 'Test', inputs: [], outputs: [{ id: 'out', label: 'Out', dataType: 'json' }],
      createData: () => ({ title: 'Flaky', retryCount: 1 }),
      execute: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary');
        return { out: { ok: true } };
      },
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'retry', name: 'Retry', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'flaky', type: 'flaky', position: { x: 0, y: 0 }, data: { title: 'Flaky', retryCount: 1 } }],
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(flaky);
    const retried = await engine.run();
    expect(retried.status).toBe('success');
    expect(retried.nodeStates.flaky.attempts).toBe(2);

    const cancellable = createDemoEngine();
    const pending = cancellable.run({ useCache: false });
    setTimeout(() => cancellable.cancel(), 30);
    const cancelled = await pending;
    expect(cancelled.status).toBe('cancelled');
  });
});
