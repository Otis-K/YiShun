import type { CanvasNode } from '../core/types';

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

interface WritableFile {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}

interface FileHandle {
  createWritable(): Promise<WritableFile>;
}

interface DirectoryHandle {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandle>;
}

interface PickerWindow extends Window {
  showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FileHandle>;
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>;
}

const mediaExtensions: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
  'text/plain': '.txt', 'application/json': '.json',
};

const defaultMime: Record<ExportAssetKind, string> = {
  image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg', text: 'text/plain', json: 'application/json', file: 'application/octet-stream',
};

const extensionFromSource = (value: string) => {
  try {
    const pathname = new URL(value, window.location.href).pathname;
    const match = /\.[A-Za-z0-9]{2,5}$/.exec(pathname);
    return match ? match[0].toLowerCase() : '';
  } catch (_) {
    return '';
  }
};

const cleanName = (value: string) => {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  return cleaned.slice(0, 120) || '衣瞬素材';
};

const nameWithExtension = (name: string, kind: ExportAssetKind, mimeType: string, source = '') => {
  const safe = cleanName(name);
  if (/\.[A-Za-z0-9]{2,5}$/.test(safe)) return safe;
  return `${safe}${mediaExtensions[mimeType] || extensionFromSource(source) || (kind === 'json' ? '.json' : kind === 'text' ? '.txt' : kind === 'image' ? '.png' : kind === 'video' ? '.mp4' : kind === 'audio' ? '.mp3' : '.bin')}`;
};

const kindFromData = (node: CanvasNode, value: Record<string, unknown>): ExportAssetKind => {
  const explicit = String(value.kind || value.previewKind || value.mediaType || value.assetKind || '');
  if (['image', 'video', 'audio', 'text', 'file'].includes(explicit)) return explicit as ExportAssetKind;
  const mimeType = String(value.mimeType || '');
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (node.type === 'image') return 'image';
  if (node.type === 'video' || node.type === 'compose') return 'video';
  if (node.type === 'audio') return 'audio';
  return 'file';
};

const mediaAsset = (node: CanvasNode, data: Record<string, unknown>, index?: number): ExportableAsset | undefined => {
  const source = String(data.preview || data.url || '');
  if (!source) return undefined;
  const kind = kindFromData(node, data);
  const mimeType = String(data.mimeType || defaultMime[kind]);
  const title = String(data.title || data.name || data.fileName || node.data.title || '衣瞬素材');
  const indexedTitle = index === undefined ? title : `${title}-${index + 1}`;
  return {
    nodeId: node.id,
    nodeTitle: String(node.data.title || node.type),
    kind,
    name: nameWithExtension(String(data.fileName || data.name || indexedTitle), kind, mimeType, source),
    mimeType,
    source,
  };
};

export function exportablesFromNode(node: CanvasNode): ExportableAsset[] {
  const data = node.data as Record<string, unknown>;
  const embedded = Array.isArray(data.embeddedMedia) ? data.embeddedMedia : [];
  const embeddedAssets = embedded.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const asset = mediaAsset(node, item as Record<string, unknown>, index);
    return asset ? [asset] : [];
  });
  if (embeddedAssets.length) return embeddedAssets;

  const media = mediaAsset(node, data);
  if (media) return [media];

  if (node.type === 'json_input') {
    const raw = String(data.prompt ?? '{}');
    let text = raw;
    try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch (_) {}
    return [{ nodeId: node.id, nodeTitle: String(data.title || 'JSON 输入'), kind: 'json', name: nameWithExtension(String(data.fileName || data.title || '衣瞬_JSON'), 'json', 'application/json'), mimeType: 'application/json', text }];
  }

  if (['prompt', 'text_input', 'text_transform', 'merge'].includes(node.type)) {
    const text = String(data.text ?? data.prompt ?? '');
    if (!text) return [];
    return [{ nodeId: node.id, nodeTitle: String(data.title || '文本'), kind: 'text', name: nameWithExtension(String(data.fileName || data.title || '衣瞬_文本'), 'text', 'text/plain'), mimeType: 'text/plain', text }];
  }
  return [];
}

export function collectSelectedAssets(nodes: readonly CanvasNode[], selectedIds: readonly string[]): ExportableAsset[] {
  const selected = new Set(selectedIds);
  return nodes.filter(node => selected.has(node.id)).flatMap(exportablesFromNode);
}

const contentBlob = async (asset: ExportableAsset) => {
  if (asset.text !== undefined) return new Blob([asset.text], { type: `${asset.mimeType};charset=utf-8` });
  if (!asset.source) throw new Error(`素材“${asset.name}”没有可保存的内容。`);
  const response = await fetch(asset.source);
  if (!response.ok) throw new Error(`读取素材“${asset.name}”失败（HTTP ${response.status}）。`);
  return response.blob();
};

const writeAsset = async (handle: FileHandle, asset: ExportableAsset) => {
  const writable = await handle.createWritable();
  if (asset.text !== undefined) {
    await writable.write(new Blob([asset.text], { type: `${asset.mimeType};charset=utf-8` }));
    await writable.close();
    return;
  }
  if (!asset.source) throw new Error(`素材“${asset.name}”没有可保存的内容。`);
  const response = await fetch(asset.source);
  if (!response.ok) throw new Error(`读取素材“${asset.name}”失败（HTTP ${response.status}）。`);
  if (response.body && typeof response.body.pipeTo === 'function') {
    await response.body.pipeTo(writable as unknown as WritableStream<Uint8Array>);
  } else {
    await writable.write(await response.blob());
    await writable.close();
  }
};

const pickerTypes = (asset: ExportableAsset) => [{
  description: `${asset.kind === 'image' ? '图片' : asset.kind === 'video' ? '视频' : asset.kind === 'audio' ? '音频' : asset.kind === 'json' ? 'JSON' : '文本'}文件`,
  accept: { [asset.mimeType]: [mediaExtensions[asset.mimeType] || `.${asset.name.split('.').pop() || 'bin'}`] },
}];

const uniqueAssets = (assets: readonly ExportableAsset[]) => {
  const counts = new Map<string, number>();
  return assets.map(asset => {
    const count = (counts.get(asset.name.toLowerCase()) || 0) + 1;
    counts.set(asset.name.toLowerCase(), count);
    if (count === 1) return asset;
    const dot = asset.name.lastIndexOf('.');
    const name = dot > 0 ? `${asset.name.slice(0, dot)}-${count}${asset.name.slice(dot)}` : `${asset.name}-${count}`;
    return { ...asset, name };
  });
};

const triggerDownload = async (asset: ExportableAsset) => {
  const blob = await contentBlob(asset);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = asset.name;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

const timestamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

export async function saveSelectedAssets(inputAssets: readonly ExportableAsset[], skipped = 0): Promise<ExportSelectionResult> {
  const assets = uniqueAssets(inputAssets);
  if (!assets.length) return { saved: 0, skipped, cancelled: false, method: 'none' };
  const pickerWindow = window as PickerWindow;
  try {
    if (assets.length === 1 && pickerWindow.showSaveFilePicker) {
      const asset = assets[0]!;
      const handle = await pickerWindow.showSaveFilePicker({ suggestedName: asset.name, types: pickerTypes(asset) });
      await writeAsset(handle, asset);
      return { saved: 1, skipped, cancelled: false, method: 'picker' };
    }
    if (assets.length > 1 && pickerWindow.showDirectoryPicker) {
      const selectedDirectory = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
      const directory = await selectedDirectory.getDirectoryHandle(`衣瞬导出_${timestamp()}`, { create: true });
      for (const asset of assets) {
        const handle = await directory.getFileHandle(asset.name, { create: true });
        await writeAsset(handle, asset);
      }
      const manifest = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        assets: assets.map(asset => ({ nodeId: asset.nodeId, nodeTitle: asset.nodeTitle, kind: asset.kind, fileName: asset.name, mimeType: asset.mimeType })),
      };
      const manifestHandle = await directory.getFileHandle('manifest.json', { create: true });
      await writeAsset(manifestHandle, { nodeId: 'manifest', nodeTitle: '导出清单', kind: 'json', name: 'manifest.json', mimeType: 'application/json', text: JSON.stringify(manifest, null, 2) });
      return { saved: assets.length, skipped, cancelled: false, method: 'directory' };
    }
    for (const asset of assets) await triggerDownload(asset);
    return { saved: assets.length, skipped, cancelled: false, method: 'download' };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { saved: 0, skipped, cancelled: true, method: 'none' };
    throw error;
  }
}
