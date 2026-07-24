import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../src/core/types';
import { collectSelectedAssets, exportablesFromNode, saveSelectedAssets } from '../src/react/asset-export';

const node = (id: string, type: string, data: Record<string, unknown>): CanvasNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { title: String(data.title || type), ...data },
});

afterEach(() => {
  Reflect.deleteProperty(window, 'showSaveFilePicker');
  Reflect.deleteProperty(window, 'showDirectoryPicker');
  vi.restoreAllMocks();
});

describe('selected asset export', () => {
  it('maps generated media, text and formatted JSON while ignoring unsupported nodes', () => {
    const nodes = [
      node('image', 'image', { title: '主视觉', preview: '/api/files/image/result.png', previewKind: 'image', mimeType: 'image/png' }),
      node('video', 'video', { title: '片头', preview: '/api/files/video/result.mp4', previewKind: 'video', mimeType: 'video/mp4' }),
      node('text', 'text_input', { title: '旁白', prompt: '衣瞬文本' }),
      node('json', 'json_input', { title: '参数', prompt: '{"quality":"2K"}' }),
      node('delay', 'delay', { title: '等待', prompt: '500' }),
    ];
    const assets = collectSelectedAssets(nodes, nodes.map(item => item.id));
    expect(assets.map(asset => asset.kind)).toEqual(['image', 'video', 'text', 'json']);
    expect(assets[0]).toMatchObject({ nodeId: 'image', source: '/api/files/image/result.png', name: '主视觉.png' });
    expect(assets[2]).toMatchObject({ nodeId: 'text', text: '衣瞬文本', name: '旁白.txt' });
    expect(assets[3]?.text).toBe('{\n  "quality": "2K"\n}');
  });

  it('exports every embedded material from a selected blank node', () => {
    const assets = exportablesFromNode(node('blank', 'blank', {
      title: '素材组',
      embeddedMedia: [
        { name: '参考图', kind: 'image', mimeType: 'image/webp', url: 'blob:image' },
        { name: '配乐', kind: 'audio', mimeType: 'audio/mpeg', url: 'blob:audio' },
      ],
    }));
    expect(assets).toHaveLength(2);
    expect(assets.map(asset => asset.name)).toEqual(['参考图.webp', '配乐.mp3']);
  });

  it('writes one selected text node through the native save picker', async () => {
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const picker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });

    const result = await saveSelectedAssets([{
      nodeId: 'text', nodeTitle: '文案', kind: 'text', name: '文案.txt', mimeType: 'text/plain', text: '保存内容',
    }]);
    expect(result).toEqual({ saved: 1, skipped: 0, cancelled: false, method: 'picker' });
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: '文案.txt' }));
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('writes multiple selected assets and a manifest into one directory', async () => {
    const written = new Map<string, unknown[]>();
    const exportDirectory = {
      getFileHandle: vi.fn(async (name: string) => ({
        createWritable: async () => ({
          write: async (value: unknown) => { written.set(name, [...(written.get(name) || []), value]); },
          close: async () => undefined,
        }),
      })),
    };
    const rootDirectory = { getDirectoryHandle: vi.fn(async () => exportDirectory) };
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn(async () => rootDirectory) });

    const result = await saveSelectedAssets([
      { nodeId: 'one', nodeTitle: '文案一', kind: 'text', name: '文案.txt', mimeType: 'text/plain', text: 'A' },
      { nodeId: 'two', nodeTitle: '文案二', kind: 'text', name: '文案.txt', mimeType: 'text/plain', text: 'B' },
    ], 1);
    expect(result).toEqual({ saved: 2, skipped: 1, cancelled: false, method: 'directory' });
    expect([...written.keys()]).toEqual(['文案.txt', '文案-2.txt', 'manifest.json']);
  });
});
