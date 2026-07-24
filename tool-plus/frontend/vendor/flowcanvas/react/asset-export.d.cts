import type { CanvasNode } from '../core/types.cjs';
export type ExportAssetKind = 'image' | 'video' | 'audio' | 'text' | 'json' | 'file';
export interface ExportableAsset {
    nodeId: string;
    nodeTitle: string;
    kind: ExportAssetKind;
    name: string;
    mimeType: string;
    source?: string;
    text?: string;
}
export interface ExportSelectionResult {
    saved: number;
    skipped: number;
    cancelled: boolean;
    method: 'picker' | 'directory' | 'download' | 'none';
}
export declare function exportablesFromNode(node: CanvasNode): ExportableAsset[];
export declare function collectSelectedAssets(nodes: readonly CanvasNode[], selectedIds: readonly string[]): ExportableAsset[];
export declare function saveSelectedAssets(inputAssets: readonly ExportableAsset[], skipped?: number): Promise<ExportSelectionResult>;
