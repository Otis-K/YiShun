import { describe, expect, it, vi } from 'vitest';
import { builtinNodeDefinitions } from '../src/builtins';
import {
  CanvasEngine,
  CanvasEngineDestroyedError,
  CanvasReadOnlyError,
} from '../src/core/engine';
import { GraphValidationError } from '../src/core/validation';
import { SpatialIndex } from '../src/core/spatial-index';
import { GraphMigrationRegistry } from '../src/core/serialization';
import type { GraphDocument, NodeDefinition } from '../src/core/types';
import { demoGraph } from '../demo/graph';

const createEngine = (options: ConstructorParameters<typeof CanvasEngine>[0] = {}) => {
  const engine = new CanvasEngine({ graph: structuredClone(demoGraph), ...options });
  builtinNodeDefinitions.forEach(definition => engine.registerNodeType(definition));
  return engine;
};

describe('CanvasEngine hardening', () => {
  it('enforces read-only at the mutation boundary while navigation and execution APIs remain available', async () => {
    const engine = createEngine({ readOnly: true });
    const before = engine.exportGraph();

    expect(() => engine.updateNodeData('script', { title: 'blocked' })).toThrow(CanvasReadOnlyError);
    expect(() => engine.removeNodes(['script'])).toThrow(CanvasReadOnlyError);
    expect(() => engine.addEdge({
      id: 'blocked', source: 'script', sourcePort: 'text', target: 'shot', targetPort: 'prompt',
    })).toThrow(CanvasReadOnlyError);
    expect(() => engine.importGraph(demoGraph)).toThrow(CanvasReadOnlyError);
    expect(() => engine.pasteClipboard()).toThrow(CanvasReadOnlyError);
    expect(() => engine.undo()).toThrow(CanvasReadOnlyError);

    engine.setSelection({ nodeIds: ['script'], edgeIds: [] });
    engine.setViewport({ x: 20, y: 30, zoom: 1.25 });
    expect(engine.getSelection().nodeIds).toEqual(['script']);
    expect(engine.validate().valid).toBe(true);
    expect((await engine.run({ useCache: false })).status).toBe('success');
    expect(engine.isReadOnly()).toBe(true);
    // Viewport and internal runtime state may change, but content edits did not.
    expect(JSON.parse(engine.exportGraph()).nodes.map((node: { id: string }) => node.id))
      .toEqual(JSON.parse(before).nodes.map((node: { id: string }) => node.id));
  });

  it('merges node data without losing existing fields and rejects duplicate edge ids', () => {
    const engine = createEngine();
    const original = engine.getGraph().nodes.find(node => node.id === 'script')!;
    engine.updateNode('script', { data: { title: 'updated' } });
    const updated = engine.getGraph().nodes.find(node => node.id === 'script')!;

    expect(updated.data.title).toBe('updated');
    expect(updated.data.prompt).toBe(original.data.prompt);
    expect(() => engine.addEdge({
      id: demoGraph.edges[0].id,
      source: 'script',
      sourcePort: 'text',
      target: 'shot',
      targetPort: 'prompt',
    })).toThrow(/ID|duplicate|\u91cd\u590d/i);
  });

  it('rejects edge fields that would make a later export fail without mutating graph or history', () => {
    const engine = createEngine();
    const before = engine.exportGraph();
    const undoLabel = engine.history.undoLabel;
    const base = {
      source: 'script', sourcePort: 'text', target: 'shot', targetPort: 'prompt',
    };

    expect(() => engine.addEdge({ ...base, id: 'bad-data', data: null } as never)).toThrow(/data.*object/i);
    expect(() => engine.addEdge({ ...base, id: 'bad-label', label: 42 } as never)).toThrow(/label.*string/i);
    expect(() => engine.addEdge({ ...base, id: 'extra', unexpected: true } as never)).toThrow(/unknown edge property/i);
    expect(engine.exportGraph()).toBe(before);
    expect(engine.history.undoLabel).toBe(undoLabel);
  });

  it('rejects extra geometry fields instead of silently dropping them during export', () => {
    const engine = createEngine();
    const before = engine.exportGraph();
    expect(() => engine.addNode('prompt', { x: 1, y: 2, z: 3 } as never)).toThrow(/unsupported property/i);
    expect(() => engine.updateNode('script', { position: { x: 1, y: 2, z: 3 } as never })).toThrow(/unsupported property/i);
    expect(() => engine.setViewport({ x: 1, y: 2, zoom: 1, tag: 'host' } as never)).toThrow(/unsupported property/i);
    expect(engine.exportGraph()).toBe(before);
  });

  it('makes the public engine facade terminal after destroy', async () => {
    const engine = createEngine();
    engine.destroy();
    engine.destroy();

    expect(() => engine.on('graph:change', () => undefined)).toThrow(CanvasEngineDestroyedError);
    expect(() => engine.addNode('prompt', { x: 0, y: 0 })).toThrow(CanvasEngineDestroyedError);
    expect(() => engine.getGraph()).toThrow(CanvasEngineDestroyedError);
    await expect(engine.run()).rejects.toBeInstanceOf(CanvasEngineDestroyedError);
    expect(engine.isRunning()).toBe(false);
  });

  it('restores selection together with graph snapshots on undo and redo', () => {
    const engine = createEngine();
    engine.setSelection({ nodeIds: ['script'], edgeIds: [] });
    const added = engine.addNode('prompt', { x: 10, y: 10 });
    expect(engine.getSelection().nodeIds).toEqual([added.id]);

    expect(engine.undo()).toBe(true);
    expect(engine.getSelection().nodeIds).toEqual(['script']);
    expect(engine.getGraph().nodes.some(node => node.id === added.id)).toBe(false);

    expect(engine.redo()).toBe(true);
    expect(engine.getSelection().nodeIds).toEqual([added.id]);
  });

  it('groups commands atomically, exposes commands, and rolls back failed transactions', () => {
    const engine = createEngine();
    engine.executeCommand('batch edit', current => {
      current.updateNodeData('script', { title: 'batch-script' });
      current.updateNodeData('character', { title: 'batch-character' });
    });
    expect(engine.history.undoLabel).toBe('batch edit');
    expect(engine.undo()).toBe(true);
    expect(engine.getGraph().nodes.find(node => node.id === 'script')?.data.title).toBe('01 · 场景脚本');
    expect(engine.getGraph().nodes.find(node => node.id === 'character')?.data.title).not.toBe('batch-character');

    const before = engine.exportGraph();
    expect(() => engine.transaction('rollback', current => {
      current.updateNodeData('script', { title: 'must rollback' });
      throw new Error('abort transaction');
    })).toThrow('abort transaction');
    expect(engine.exportGraph()).toBe(before);
  });

  it('isolates event and subscriber failures while reporting them on the error channel', () => {
    const engine = createEngine();
    const second = vi.fn();
    const errors: string[] = [];
    engine.on('error', event => errors.push(event.source));
    engine.on('graph:change', () => { throw new Error('host listener failed'); });
    engine.on('graph:change', second);
    engine.subscribe(() => { throw new Error('subscriber failed'); });

    expect(() => engine.updateNodeData('script', { title: 'still commits' })).not.toThrow();
    expect(second).toHaveBeenCalledOnce();
    expect(errors).toContain('event-listener:graph:change');
    expect(errors).toContain('subscriber');
    expect(engine.getGraph().nodes.find(node => node.id === 'script')?.data.title).toBe('still commits');
  });

  it('offers a stable zero-copy snapshot and caches validation until relevant content changes', () => {
    let validations = 0;
    const definition: NodeDefinition = {
      type: 'tracked', title: 'Tracked', category: 'Test', inputs: [], outputs: [],
      createData: () => ({ title: 'Tracked' }),
      validate: () => { validations += 1; return []; },
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'tracked', name: 'Tracked', edges: [], metadata: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [{ id: 'n', type: 'tracked', position: { x: 0, y: 0 }, data: { title: 'Tracked' } }],
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(definition);
    const snapshot = engine.getGraphSnapshot();

    engine.getValidationSnapshot();
    engine.getValidationSnapshot();
    expect(validations).toBe(1);
    engine.updateNode('n', { position: { x: 50, y: 60 } }, { record: false });
    expect(engine.getGraphSnapshot()).toBe(snapshot);
    engine.getValidationSnapshot();
    expect(validations).toBe(1);
    const beforeEdit = engine.captureSnapshot();
    engine.updateNodeData('n', { title: 'changed' }, { record: false, transient: true });
    engine.getValidationSnapshot();
    expect(validations).toBe(1);
    engine.commitSnapshot('edit title', beforeEdit);
    engine.getValidationSnapshot();
    expect(validations).toBe(2);
  });

  it('exposes a runtime-enforced deep read-only view and isolates nested write aliases', () => {
    const engine = new CanvasEngine();
    engine.registerNodeType({
      type: 'source', title: 'Source', category: 'Test', inputs: [],
      outputs: [{ id: 'out', label: 'Out', dataType: 'json' }],
      createData: () => ({ title: 'Source', nested: { value: 0 } }),
    });
    engine.registerNodeType({
      type: 'sink', title: 'Sink', category: 'Test',
      inputs: [{ id: 'in', label: 'In', dataType: 'json' }], outputs: [],
      createData: () => ({ title: 'Sink' }),
    });
    const nested = { value: 1 };
    const sourceNode = engine.addNode('source', { x: 0, y: 0 }, { nested });
    nested.value = 99;
    expect((engine.getGraph().nodes[0].data.nested as { value: number }).value).toBe(1);

    const patch = { value: 2 };
    engine.updateNodeData(sourceNode.id, { nested: patch });
    patch.value = 88;
    expect((engine.getGraph().nodes[0].data.nested as { value: number }).value).toBe(2);

    const sinkNode = engine.addNode('sink', { x: 100, y: 0 });
    const edgeData = { nested: { safe: true } };
    engine.addEdge({ source: sourceNode.id, sourcePort: 'out', target: sinkNode.id, targetPort: 'in', data: edgeData });
    edgeData.nested.safe = false;
    expect((engine.getGraph().edges[0].data?.nested as { safe: boolean }).safe).toBe(true);

    const snapshot = engine.getGraphSnapshot();
    expect(() => { (snapshot.nodes[0].data as { title: string }).title = 'hack'; }).toThrow(/read-only/i);
    const rawDescriptor = Object.getOwnPropertyDescriptor(snapshot, 'nodes');
    expect(() => {
      const escaped = rawDescriptor?.value as Array<{ data: { title: string } }>;
      escaped[0].data.title = 'descriptor hack';
    }).toThrow(/read-only/i);
    expect(engine.getGraph().nodes[0].data.title).toBe('Source');
  });

  it('forces authoritative validation before validate/run after transient edits', async () => {
    const execute = vi.fn(() => ({ output: 'ok' }));
    const definition: NodeDefinition = {
      type: 'validated', title: 'Validated', category: 'Test', inputs: [], outputs: [],
      createData: () => ({ title: 'good' }),
      validate: node => node.data.title === 'bad' ? [{
        code: 'NODE_CONFIGURATION_INVALID', severity: 'error', message: 'bad title', nodeId: node.id,
      }] : [],
      execute,
    };
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'authoritative', name: 'Authoritative', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'node', type: 'validated', position: { x: 0, y: 0 }, data: { title: 'good' } }],
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(definition);
    expect(engine.getValidationSnapshot().valid).toBe(true);
    engine.updateNodeData('node', { title: 'bad' }, { record: false, transient: true });
    expect(engine.getValidationSnapshot().valid).toBe(true);
    expect(engine.validate().valid).toBe(false);
    await expect(engine.run()).rejects.toBeInstanceOf(GraphValidationError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects non-finite geometry before spatial indexing and keeps history mutation private', () => {
    const engine = createEngine();
    expect(() => engine.updateNode('script', { position: { x: Number.POSITIVE_INFINITY, y: 0 } })).toThrow(/finite/i);
    expect(() => engine.setViewport({ x: 0, y: 0, zoom: Number.NaN })).toThrow(/finite/i);
    expect((engine.history as unknown as { undo?: unknown }).undo).toBeUndefined();
    engine.setReadOnly(true);
    expect(() => (engine.history as unknown as { undo: () => void }).undo()).toThrow();

    const index = new SpatialIndex();
    expect(() => index.query({ x: Number.NaN, y: 0, width: 10, height: 10 })).toThrow(/finite/i);
    expect(() => index.upsert({
      id: 'bad', type: 'x', position: { x: Number.POSITIVE_INFINITY, y: 0 }, data: { title: 'bad' },
    })).toThrow(/finite/i);
  });

  it('rejects non-JSON graph data atomically without changing history or version', () => {
    const engine = createEngine();
    const before = engine.exportGraph();
    const version = engine.getVersion();
    expect(() => engine.addNode('prompt', { x: 0, y: 0 }, { bad: 1n })).toThrow(/JSON/i);
    expect(engine.exportGraph()).toBe(before);
    expect(engine.getVersion()).toBe(version);
    expect(engine.history.canUndo).toBe(false);

    expect(() => engine.updateNodeData('script', { bad: new Date() })).toThrow(/plain JSON/i);
    expect(engine.exportGraph()).toBe(before);
    expect(engine.getVersion()).toBe(version);
  });

  it('rejects JavaScript-only patch key injection and invalid clipboard offsets', () => {
    const engine = createEngine();
    const before = engine.exportGraph();
    expect(() => engine.updateNode('script', { id: 'forged' } as never)).toThrow(/unsupported.*id/i);
    expect(engine.exportGraph()).toBe(before);
    engine.setSelection({ nodeIds: ['script'], edgeIds: [] });
    engine.copySelection();
    expect(() => engine.pasteClipboard({ x: Number.POSITIVE_INFINITY, y: 0 })).toThrow(/finite/i);
    expect(engine.exportGraph()).toBe(before);
  });

  it('turns faulty plugin validators into issues instead of partial-operation throws', () => {
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'validator-error', name: 'Validator error', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}, edges: [],
      nodes: [{ id: 'node', type: 'broken-validator', position: { x: 0, y: 0 }, data: { title: 'Node' } }],
    };
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType({
      type: 'broken-validator', title: 'Broken', category: 'Test', inputs: [], outputs: [],
      createData: () => ({ title: 'Broken' }), validate: () => { throw new Error('plugin exploded'); },
    });
    engine.on('validation:change', () => undefined);
    expect(() => engine.updateNodeData('node', { title: 'still committed' })).not.toThrow();
    const result = engine.validate();
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: 'NODE_CONFIGURATION_INVALID', nodeId: 'node' });
    expect(result.issues[0].message).toContain('plugin exploded');
    expect(engine.getGraph().nodes[0].data.title).toBe('still committed');
  });

  it('supports strict registered migration chains and rejects gaps or wrong output versions', () => {
    const registry = new GraphMigrationRegistry(3);
    registry.register(0, 1, document => ({ ...document, schemaVersion: 1, one: true }));
    registry.register(1, 2, document => ({ ...document, schemaVersion: 2, two: true }));
    registry.register(2, 3, document => ({ ...document, schemaVersion: 3, three: true }));
    expect(registry.migrate({ schemaVersion: 0 })).toMatchObject({
      schemaVersion: 3, one: true, two: true, three: true,
    });

    const gap = new GraphMigrationRegistry(2);
    gap.register(0, 1, document => ({ ...document, schemaVersion: 1 }));
    expect(() => gap.migrate({ schemaVersion: 0 })).toThrow('Missing graph migration');
    expect(() => gap.register(0, 2, document => document)).toThrow('adjacent');

    const wrong = new GraphMigrationRegistry(1);
    wrong.register(0, 1, document => ({ ...document, schemaVersion: 0 }));
    expect(() => wrong.migrate({ schemaVersion: 0 })).toThrow('returned schema version');
  });

  it('restores layered migrations correctly when replacement disposers run out of order', () => {
    const registry = new GraphMigrationRegistry(1);
    registry.register(0, 1, document => ({ ...document, schemaVersion: 1, layer: 'base' }));
    const disposeFirst = registry.register(0, 1, document => ({ ...document, schemaVersion: 1, layer: 'first' }), { replace: true });
    const disposeSecond = registry.register(0, 1, document => ({ ...document, schemaVersion: 1, layer: 'second' }), { replace: true });
    expect(registry.migrate({}).layer).toBe('second');
    disposeFirst();
    expect(registry.migrate({}).layer).toBe('second');
    disposeSecond();
    expect(registry.migrate({}).layer).toBe('base');
  });
});
