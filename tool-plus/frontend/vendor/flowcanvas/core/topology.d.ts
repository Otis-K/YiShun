import type { GraphDocument, NodeId } from './types.js';
export interface TopologyResult {
    order: NodeId[];
    layers: NodeId[][];
    cyclicNodeIds: NodeId[];
}
export declare function analyzeTopology(graph: Pick<GraphDocument, 'nodes' | 'edges'>): TopologyResult;
export declare function wouldCreateCycle(graph: Pick<GraphDocument, 'nodes' | 'edges'>, source: NodeId, target: NodeId): boolean;
