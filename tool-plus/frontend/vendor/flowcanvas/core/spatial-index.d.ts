import type { CanvasNode, CanvasRect, NodeId } from './types.js';
export interface SpatialIndexOptions {
    cellSize?: number;
    defaultNodeWidth?: number;
    defaultNodeHeight?: number;
}
/**
 * A dependency-free uniform-grid index for viewport culling and hit testing.
 * Rebuild is O(N); a query visits only intersecting cells and their candidates.
 */
export declare class SpatialIndex {
    private readonly cells;
    private readonly entries;
    private readonly entryCells;
    private readonly oversizedEntries;
    private readonly cellSize;
    private readonly defaultNodeWidth;
    private readonly defaultNodeHeight;
    constructor(options?: SpatialIndexOptions);
    get size(): number;
    clear(): void;
    rebuild(nodes: readonly CanvasNode[]): void;
    upsert(node: CanvasNode): void;
    remove(id: NodeId): boolean;
    query(rectInput: CanvasRect): NodeId[];
    private keysFor;
}
