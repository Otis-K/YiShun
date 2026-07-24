import type { CanvasEdge, GraphDocument, NodeId } from './types';

export interface TopologyResult {
  order: NodeId[];
  layers: NodeId[][];
  cyclicNodeIds: NodeId[];
}

export function analyzeTopology(graph: Pick<GraphDocument, 'nodes' | 'edges'>): TopologyResult {
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  const inDegree = new Map<NodeId, number>();
  const outgoing = new Map<NodeId, CanvasEdge[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    outgoing.set(id, []);
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  let frontier = [...nodeIds].filter(id => inDegree.get(id) === 0);
  const order: NodeId[] = [];
  const layers: NodeId[][] = [];
  const processed = new Set<NodeId>();

  while (frontier.length) {
    // Map/Set insertion order is deterministic for a given graph, so sorting
    // every layer is unnecessary and would turn this into O(N log N).
    const layer = frontier;
    layers.push(layer);
    const next: NodeId[] = [];
    for (const id of layer) {
      order.push(id);
      processed.add(id);
      for (const edge of outgoing.get(id) ?? []) {
        const degree = (inDegree.get(edge.target) ?? 0) - 1;
        inDegree.set(edge.target, degree);
        if (degree === 0) next.push(edge.target);
      }
    }
    frontier = next;
  }

  return {
    order,
    layers,
    cyclicNodeIds: [...nodeIds].filter(id => !processed.has(id)),
  };
}

export function wouldCreateCycle(
  graph: Pick<GraphDocument, 'nodes' | 'edges'>,
  source: NodeId,
  target: NodeId,
): boolean {
  if (source === target) return true;
  const outgoing = new Map<NodeId, NodeId[]>();
  for (const node of graph.nodes) outgoing.set(node.id, []);
  for (const edge of graph.edges) outgoing.get(edge.source)?.push(edge.target);
  outgoing.get(source)?.push(target);

  const stack = [target];
  const visited = new Set<NodeId>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }
  return false;
}
