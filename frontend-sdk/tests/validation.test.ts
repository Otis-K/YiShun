import { describe, expect, it } from 'vitest';
import { builtinNodeDefinitions } from '../src/builtins';
import { NodeRegistry } from '../src/core/registry';
import { analyzeTopology, wouldCreateCycle } from '../src/core/topology';
import type { GraphDocument, NodeDefinition } from '../src/core/types';
import { validateGraph } from '../src/core/validation';
import { demoGraph } from '../demo/graph';

const registryWithBuiltins = () => {
  const registry = new NodeRegistry();
  builtinNodeDefinitions.forEach(definition => registry.register(definition));
  return registry;
};

describe('graph validation', () => {
  it('accepts the complete demo DAG and returns a stable topological order', () => {
    const registry = registryWithBuiltins();
    const validation = validateGraph(demoGraph, registry);
    const topology = analyzeTopology(demoGraph);

    expect(validation.valid).toBe(true);
    expect(topology.cyclicNodeIds).toEqual([]);
    expect(topology.order.indexOf('script')).toBeLessThan(topology.order.indexOf('shot'));
    expect(topology.order.indexOf('shot')).toBeLessThan(topology.order.indexOf('compose'));
  });

  it('reports missing required inputs and incompatible port types', () => {
    const registry = registryWithBuiltins();
    const graph: GraphDocument = structuredClone(demoGraph);
    graph.edges = [
      { id: 'bad-edge', source: 'voice', sourcePort: 'audio', target: 'character', targetPort: 'reference' },
    ];
    const result = validateGraph(graph, registry);

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => issue.code === 'PORT_TYPE_MISMATCH')).toBe(true);
    expect(result.issues.some(issue => issue.code === 'REQUIRED_INPUT_MISSING')).toBe(true);
  });

  it('detects a cycle before and after connection creation', () => {
    const passthrough: NodeDefinition = {
      type: 'passthrough', title: 'Pass', category: 'Test',
      inputs: [{ id: 'in', label: 'In', dataType: 'any' }],
      outputs: [{ id: 'out', label: 'Out', dataType: 'any' }],
      createData: () => ({ title: 'Pass' }),
    };
    const registry = new NodeRegistry();
    registry.register(passthrough);
    const graph: GraphDocument = {
      schemaVersion: 1, id: 'cycle', name: 'Cycle', viewport: { x: 0, y: 0, zoom: 1 }, metadata: {},
      nodes: [
        { id: 'a', type: 'passthrough', position: { x: 0, y: 0 }, data: { title: 'A' } },
        { id: 'b', type: 'passthrough', position: { x: 100, y: 0 }, data: { title: 'B' } },
      ],
      edges: [
        { id: 'ab', source: 'a', sourcePort: 'out', target: 'b', targetPort: 'in' },
        { id: 'ba', source: 'b', sourcePort: 'out', target: 'a', targetPort: 'in' },
      ],
    };

    expect(wouldCreateCycle({ ...graph, edges: graph.edges.slice(0, 1) }, 'b', 'a')).toBe(true);
    expect(validateGraph(graph, registry).issues.some(issue => issue.code === 'CYCLE_DETECTED')).toBe(true);
  });
});
