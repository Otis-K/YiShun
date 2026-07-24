import { describe, expect, it, vi } from 'vitest';
import { CanvasEngine } from '../src/core/engine';
import { SpatialIndex } from '../src/core/spatial-index';
import { analyzeTopology } from '../src/core/topology';
import type { CanvasNode, GraphDocument } from '../src/core/types';

const makeNodes = (count: number): CanvasNode[] => Array.from({ length: count }, (_, index) => ({
  id: `n${index}`,
  type: 'benchmark',
  position: { x: (index % 200) * 320, y: Math.floor(index / 200) * 220 },
  data: { title: `Node ${index}` },
}));

describe('large graph performance guards', () => {
  it('analyzes a 25k-node DAG in linear time without quadratic cycle filtering', () => {
    const nodes = makeNodes(25_000);
    const edges = Array.from({ length: nodes.length - 1 }, (_, index) => ({
      id: `e${index}`,
      source: `n${index}`,
      sourcePort: 'out',
      target: `n${index + 1}`,
      targetPort: 'in',
    }));
    const started = performance.now();
    const result = analyzeTopology({ nodes, edges });
    const elapsed = performance.now() - started;

    expect(result.order).toHaveLength(nodes.length);
    expect(result.cyclicNodeIds).toEqual([]);
    expect(elapsed).toBeLessThan(3_000);
  });

  it('indexes and queries 25k nodes without scanning the graph for every viewport query', () => {
    const nodes = makeNodes(25_000);
    const index = new SpatialIndex();
    const started = performance.now();
    index.rebuild(nodes);
    const result = index.query({ x: 0, y: 0, width: 2_000, height: 1_000 });
    const elapsed = performance.now() - started;

    expect(index.size).toBe(nodes.length);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(200);
    expect(elapsed).toBeLessThan(3_000);
  });

  it('does not clone or emit graph changes for transient record:false node updates', () => {
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'hot-path', name: 'Hot path', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: makeNodes(5_000),
    };
    const engine = new CanvasEngine({ graph });
    const graphChanges = vi.fn();
    engine.on('graph:change', graphChanges);
    const before = engine.captureSnapshot();
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone');
    cloneSpy.mockClear();

    engine.updateNode(
      'n2500',
      { position: { x: 1234, y: 5678 } },
      { record: false, transient: true },
    );

    expect(cloneSpy).not.toHaveBeenCalled();
    expect(graphChanges).not.toHaveBeenCalled();
    expect(engine.getGraphSnapshot().nodes[2500].position).toEqual({ x: 1234, y: 5678 });
    cloneSpy.mockRestore();

    engine.commitSnapshot('move node', before);
    expect(graphChanges).toHaveBeenCalledOnce();
  });

  it('defers large-graph validation during transient text input until commit', () => {
    let validationCalls = 0;
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'validation-hot-path', name: 'Validation hot path',
      viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [], nodes: makeNodes(5_000),
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType({
      type: 'benchmark', title: 'Benchmark', category: 'Test', inputs: [], outputs: [],
      createData: () => ({ title: 'Benchmark' }),
      validate: () => { validationCalls += 1; return []; },
    });
    engine.getValidationSnapshot();
    expect(validationCalls).toBe(5_000);
    const before = engine.captureSnapshot();

    for (let index = 0; index < 50; index += 1) {
      engine.updateNodeData(
        'n2500',
        { title: `typing-${index}` },
        { record: false, transient: true },
      );
      engine.getValidationSnapshot();
    }
    expect(validationCalls).toBe(5_000);

    engine.commitSnapshot('edit node title', before);
    engine.getValidationSnapshot();
    expect(validationCalls).toBe(10_000);
  });
});
