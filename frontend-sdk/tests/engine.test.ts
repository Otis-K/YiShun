import { describe, expect, it } from 'vitest';
import { builtinNodeDefinitions } from '../src/builtins';
import { CanvasEngine } from '../src/core/engine';
import { deserializeGraph, serializeGraph } from '../src/core/serialization';
import { demoGraph } from '../demo/graph';

const createEngine = () => {
  const engine = new CanvasEngine({ graph: structuredClone(demoGraph) });
  builtinNodeDefinitions.forEach(definition => engine.registerNodeType(definition));
  return engine;
};

describe('CanvasEngine', () => {
  it('records real undo and redo snapshots', () => {
    const engine = createEngine();
    engine.updateNodeData('script', { title: '新标题' });
    expect(engine.getGraph().nodes.find(node => node.id === 'script')?.data.title).toBe('新标题');

    expect(engine.undo()).toBe(true);
    expect(engine.getGraph().nodes.find(node => node.id === 'script')?.data.title).toBe('01 · 场景脚本');

    expect(engine.redo()).toBe(true);
    expect(engine.getGraph().nodes.find(node => node.id === 'script')?.data.title).toBe('新标题');
  });

  it('copies and pastes selected subgraphs with new identifiers', () => {
    const engine = createEngine();
    engine.setSelection({ nodeIds: ['script', 'character'], edgeIds: [] });
    const copied = engine.copySelection();
    const pastedIds = engine.pasteClipboard();
    const graph = engine.getGraph();

    expect(copied.nodes).toHaveLength(2);
    expect(copied.edges).toHaveLength(1);
    expect(pastedIds).toHaveLength(2);
    expect(graph.nodes).toHaveLength(demoGraph.nodes.length + 2);
    expect(graph.edges).toHaveLength(demoGraph.edges.length + 1);
    expect(pastedIds.every(id => !['script', 'character'].includes(id))).toBe(true);
  });

  it('round-trips versioned JSON and migrates version zero documents', () => {
    const json = serializeGraph(demoGraph);
    expect(deserializeGraph(json)).toEqual(demoGraph);

    const legacy = { ...structuredClone(demoGraph), schemaVersion: 0 };
    const migrated = deserializeGraph(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.nodes).toHaveLength(demoGraph.nodes.length);
  });

  it('does not notify subscribers when selection is unchanged', () => {
    const engine = createEngine();
    let notifications = 0;
    engine.subscribe(() => { notifications += 1; });

    engine.setSelection({ nodeIds: ['script'], edgeIds: [] });
    engine.setSelection({ nodeIds: ['script', 'script'], edgeIds: [] });

    expect(notifications).toBe(1);
  });

  it('runs one node with transitive upstream dependencies and excludes unrelated branches', async () => {
    const engine = createEngine();
    const result = await engine.runNode('shot', { useCache: false });

    expect(result.status).toBe('success');
    expect(Object.keys(result.nodeStates).sort()).toEqual(['character', 'script', 'shot']);
    expect(Object.keys(result.outputs).sort()).toEqual(['character', 'script', 'shot']);
    expect(result.nodeStates.shot.status).toBe('success');
    expect(result.nodeStates.voice).toBeUndefined();
    expect(result.outputs.compose).toBeUndefined();
  });
});
