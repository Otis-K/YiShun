import type { CanvasNode, CanvasRect, NodeId } from './types';

export interface SpatialIndexOptions {
  cellSize?: number;
  defaultNodeWidth?: number;
  defaultNodeHeight?: number;
}

const intersects = (left: CanvasRect, right: CanvasRect): boolean => (
  left.x <= right.x + right.width
  && left.x + left.width >= right.x
  && left.y <= right.y + right.height
  && left.y + left.height >= right.y
);

const normalizeRect = (rect: CanvasRect): CanvasRect => {
  for (const [key, value] of Object.entries(rect)) {
    if (!Number.isFinite(value)) throw new RangeError(`Spatial rectangle ${key} must be finite.`);
  }
  const width = rect.width;
  const height = rect.height;
  return {
    x: width < 0 ? rect.x + width : rect.x,
    y: height < 0 ? rect.y + height : rect.y,
    width: Math.abs(width),
    height: Math.abs(height),
  };
};

/**
 * A dependency-free uniform-grid index for viewport culling and hit testing.
 * Rebuild is O(N); a query visits only intersecting cells and their candidates.
 */
export class SpatialIndex {
  private readonly cells = new Map<string, Set<NodeId>>();
  private readonly entries = new Map<NodeId, CanvasRect>();
  private readonly entryCells = new Map<NodeId, string[]>();
  private readonly oversizedEntries = new Set<NodeId>();
  private readonly cellSize: number;
  private readonly defaultNodeWidth: number;
  private readonly defaultNodeHeight: number;

  constructor(options: SpatialIndexOptions = {}) {
    const cellSize = options.cellSize ?? 512;
    const defaultNodeWidth = options.defaultNodeWidth ?? 280;
    const defaultNodeHeight = options.defaultNodeHeight ?? 180;
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Spatial cellSize must be finite and greater than zero.');
    if (!Number.isFinite(defaultNodeWidth) || defaultNodeWidth < 0) throw new RangeError('Default node width must be finite and non-negative.');
    if (!Number.isFinite(defaultNodeHeight) || defaultNodeHeight < 0) throw new RangeError('Default node height must be finite and non-negative.');
    this.cellSize = Math.max(32, Math.floor(cellSize));
    this.defaultNodeWidth = defaultNodeWidth;
    this.defaultNodeHeight = defaultNodeHeight;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.cells.clear();
    this.entries.clear();
    this.entryCells.clear();
    this.oversizedEntries.clear();
  }

  rebuild(nodes: readonly CanvasNode[]): void {
    this.clear();
    for (const node of nodes) this.upsert(node);
  }

  upsert(node: CanvasNode): void {
    this.remove(node.id);
    const rect = normalizeRect({
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? this.defaultNodeWidth,
      height: node.height ?? this.defaultNodeHeight,
    });
    const keys = this.keysFor(rect, 4_096);
    this.entries.set(node.id, rect);
    if (!keys) {
      this.entryCells.set(node.id, []);
      this.oversizedEntries.add(node.id);
      return;
    }
    this.entryCells.set(node.id, keys);
    for (const key of keys) {
      const bucket = this.cells.get(key) ?? new Set<NodeId>();
      bucket.add(node.id);
      this.cells.set(key, bucket);
    }
  }

  remove(id: NodeId): boolean {
    if (!this.entries.has(id)) return false;
    for (const key of this.entryCells.get(id) ?? []) {
      const bucket = this.cells.get(key);
      bucket?.delete(id);
      if (bucket?.size === 0) this.cells.delete(key);
    }
    this.entries.delete(id);
    this.entryCells.delete(id);
    this.oversizedEntries.delete(id);
    return true;
  }

  query(rectInput: CanvasRect): NodeId[] {
    const rect = normalizeRect(rectInput);
    const keys = this.keysFor(rect, 100_000);
    if (!keys) {
      return [...this.entries].filter(([, entry]) => intersects(entry, rect)).map(([id]) => id);
    }
    const candidates = new Set<NodeId>();
    for (const id of this.oversizedEntries) candidates.add(id);
    for (const key of keys) {
      for (const id of this.cells.get(key) ?? []) candidates.add(id);
    }
    return [...candidates].filter(id => intersects(this.entries.get(id)!, rect));
  }

  private keysFor(rect: CanvasRect, limit: number): string[] | undefined {
    const minX = Math.floor(rect.x / this.cellSize);
    const minY = Math.floor(rect.y / this.cellSize);
    const maxX = Math.floor((rect.x + rect.width) / this.cellSize);
    const maxY = Math.floor((rect.y + rect.height) / this.cellSize);
    const columns = maxX - minX + 1;
    const rows = maxY - minY + 1;
    if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns * rows > limit) return undefined;
    const keys: string[] = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  }
}
