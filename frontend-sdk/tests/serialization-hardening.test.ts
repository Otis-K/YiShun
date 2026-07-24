import { describe, expect, it } from 'vitest';
import { deserializeGraph, serializeGraph } from '../src/core/serialization';
import type { GraphDocument } from '../src/core/types';

const validGraph = (): GraphDocument => ({
  schemaVersion: 1,
  id: 'graph',
  name: 'Strict graph',
  viewport: { x: 0, y: 0, zoom: 1 },
  metadata: { owner: 'test', nested: [1, true, null] },
  nodes: [{
    id: 'node',
    type: 'custom.unknown-but-preserved',
    position: { x: 12, y: 34 },
    data: { title: 'Node', custom: { value: 1 } },
  }],
  edges: [],
});

describe('strict graph serialization boundary', () => {
  it('round-trips valid documents and preserves unknown node types and custom JSON data', () => {
    const graph = validGraph();
    const result = deserializeGraph(serializeGraph(graph));
    expect(result).toEqual(graph);
    expect(result).not.toBe(graph);
  });

  it.each([
    ['non-object node', (graph: GraphDocument) => { graph.nodes = [null as never]; }],
    ['blank node id', (graph: GraphDocument) => { graph.nodes[0].id = '   '; }],
    ['non-finite position', (graph: GraphDocument) => { graph.nodes[0].position.x = Number.NaN; }],
    ['missing title', (graph: GraphDocument) => { delete (graph.nodes[0].data as { title?: string }).title; }],
    ['invalid viewport zoom', (graph: GraphDocument) => { graph.viewport.zoom = 0; }],
    ['duplicate node id', (graph: GraphDocument) => { graph.nodes.push(structuredClone(graph.nodes[0])); }],
    ['malformed edge', (graph: GraphDocument) => { graph.edges.push({ id: 'edge' } as never); }],
  ] as const)('rejects %s', (_label, alter) => {
    const graph = validGraph();
    alter(graph);
    expect(() => deserializeGraph(graph)).toThrow();
  });

  it('rejects non-JSON metadata and future schema versions', () => {
    const dateGraph = validGraph();
    dateGraph.metadata.createdAt = new Date() as unknown as string;
    expect(() => deserializeGraph(dateGraph)).toThrow(/plain JSON/i);

    const future = { ...validGraph(), schemaVersion: 999 };
    expect(() => deserializeGraph(future)).toThrow(/Unsupported graph schema version/i);
    for (const schemaVersion of ['1', true, null, ''] as const) {
      expect(() => deserializeGraph({ ...validGraph(), schemaVersion } as never)).toThrow(/schema version/i);
    }
  });

  it('refuses to export values that JSON would otherwise silently coerce or omit', () => {
    const dated = validGraph();
    dated.nodes[0].data.date = new Date() as unknown as string;
    expect(() => serializeGraph(dated)).toThrow(/plain JSON/i);

    const undefinedValue = validGraph();
    undefinedValue.nodes[0].data.missing = undefined;
    expect(() => serializeGraph(undefinedValue)).toThrow(/non-JSON/i);

    const sparse = validGraph();
    const sparseValues = new Array(2) as unknown[];
    sparseValues[1] = 'kept';
    sparse.nodes[0].data.values = sparseValues;
    expect(() => serializeGraph(sparse)).toThrow(/sparse array/i);

    const extendedArray = validGraph();
    const values = ['kept'] as string[] & { hidden?: string };
    values.hidden = 'would be omitted';
    extendedArray.nodes[0].data.values = values;
    expect(() => serializeGraph(extendedArray)).toThrow(/array property/i);
    expect(() => serializeGraph(validGraph(), 11)).toThrow(/indentation/i);
  });

  it('migrates a legacy version-zero document through the registered default chain', () => {
    const legacy = validGraph() as unknown as Record<string, unknown>;
    delete legacy.schemaVersion;
    delete legacy.viewport;
    delete legacy.metadata;
    const result = deserializeGraph(legacy);
    expect(result.schemaVersion).toBe(1);
    expect(result.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(result.metadata).toEqual({});
  });
});
