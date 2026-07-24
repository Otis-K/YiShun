import type { CanvasNodeData, NodeDefinition } from './core/types';
import {
  createGenerationDrafts,
  generationDataPatch,
  type GenerationDrafts,
  type GenerationMode,
} from './generation';

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) {
    reject(new DOMException('Cancelled', 'AbortError'));
    return;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(new DOMException('Cancelled', 'AbortError'));
  };
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  signal.addEventListener('abort', onAbort, { once: true });
});

const baseData = (title: string, description: string): CanvasNodeData => ({
  title,
  description,
  status: 'idle',
  progress: 0,
  retryCount: 0,
  cache: true,
});

const generationData = (
  mode: GenerationMode,
  title: string,
  description: string,
  draft: Partial<GenerationDrafts[GenerationMode]> = {},
): CanvasNodeData => {
  const drafts = createGenerationDrafts();
  Object.assign(drafts[mode], draft);
  return { ...baseData(title, description), ...generationDataPatch(mode, drafts) };
};

export const builtinNodeDefinitions: NodeDefinition[] = [
  {
    type: 'blank',
    title: '空白节点',
    category: '素材',
    description: '空白媒体容器，可嵌入图片、视频和音频。',
    icon: 'image',
    color: '#9da3ad',
    inputs: [{ id: 'input', label: '输入', dataType: 'any' }],
    outputs: [{ id: 'output', label: '输出', dataType: 'any', multiple: true }],
    createData: () => ({
      ...baseData('空白节点', '拖入或上传图片、视频、音频后会嵌入到这里'),
      embeddedMedia: [],
    }),
    execute: ({ node, inputs, emitProgress }) => {
      emitProgress(1, '空白节点已读取');
      return {
        output: {
          input: inputs.input,
          media: node.data.embeddedMedia ?? [],
          preview: node.data.preview,
          previewKind: node.data.previewKind,
          fileName: node.data.fileName,
        },
      };
    },
  },
  {
    type: 'prompt',
    title: '场景脚本',
    category: '创作',
    description: '输入脚本、提示词或镜头描述',
    icon: 'text',
    color: '#79e6c5',
    inputs: [],
    outputs: [{ id: 'text', label: '文本', dataType: 'text' }],
    createData: () => generationData('text', '场景脚本', '输入脚本、提示词或镜头描述', {
      prompt: '雨夜的旧车站，女主在站台尽头认出多年未见的故人。',
    }),
    validate: node => node.data.prompt?.toString().trim()
      ? []
      : [{ code: 'NODE_CONFIGURATION_INVALID', severity: 'error', message: '提示词不能为空', nodeId: node.id }],
    execute: ({ node }) => ({ text: node.data.prompt ?? '' }),
  },
  {
    type: 'image',
    title: '图片生成',
    category: '生成',
    description: '根据文本和参考素材生成画面',
    icon: 'image',
    color: '#80aefa',
    inputs: [
      { id: 'prompt', label: '提示词', dataType: 'text' },
      { id: 'reference', label: '参考图', dataType: 'image', multiple: true },
    ],
    outputs: [{ id: 'image', label: '图像', dataType: 'image' }],
    createData: () => generationData('image', '图片生成', '根据文本和参考素材生成画面'),
    execute: async ({ inputs, signal, emitProgress, node }) => {
      emitProgress(.2, '解析提示词');
      await wait(180, signal);
      emitProgress(.7, '生成画面');
      await wait(260, signal);
      return { image: { kind: 'image', prompt: inputs.prompt ?? node.data.prompt, model: node.data.model, preview: node.data.preview } };
    },
  },
  {
    type: 'video',
    title: '视频生成',
    category: '生成',
    description: '根据提示词和首帧生成镜头',
    icon: 'video',
    color: '#f0ba7b',
    inputs: [
      { id: 'prompt', label: '提示词 / 上游内容', dataType: 'any' },
      { id: 'image', label: '首帧 / 参考素材', dataType: 'any', multiple: true },
      { id: 'lastFrame', label: '尾帧 / 延续素材', dataType: 'any' },
    ],
    outputs: [{ id: 'video', label: '视频', dataType: 'video', multiple: true }],
    createData: () => generationData('video', '视频生成', '根据提示词和首尾帧生成镜头'),
    execute: async ({ inputs, signal, emitProgress, node }) => {
      for (const [progress, message] of [[.15, '准备素材'], [.45, '生成关键帧'], [.78, '合成镜头']] as const) {
        emitProgress(progress, message);
        await wait(180, signal);
      }
      return { video: {
        kind: 'video', prompt: inputs.prompt ?? node.data.prompt, image: inputs.image,
        lastFrame: inputs.lastFrame ?? node.data.lastFrame, model: node.data.model, duration: node.data.duration,
      } };
    },
  },
  {
    type: 'audio',
    title: '音频生成',
    category: '生成',
    description: '根据台词生成角色语音',
    icon: 'audio',
    color: '#73d6a4',
    inputs: [{ id: 'text', label: '台词', dataType: 'text' }],
    outputs: [{ id: 'audio', label: '音频', dataType: 'audio' }],
    createData: () => generationData('audio', '音频生成', '根据描述生成音乐或角色语音'),
    execute: async ({ inputs, signal, emitProgress, node }) => {
      emitProgress(.5, '合成语音');
      await wait(280, signal);
      return { audio: { kind: 'audio', text: inputs.text ?? node.data.prompt, model: node.data.model, lyricsMode: node.data.lyricsMode } };
    },
  },
  {
    type: 'compose',
    title: '镜头合成',
    category: '输出',
    description: '合并视频、配音和字幕',
    icon: 'output',
    color: '#c8ccd2',
    inputs: [
      { id: 'video', label: '视频', dataType: 'video', required: true },
      { id: 'audio', label: '音频', dataType: 'audio' },
    ],
    outputs: [{ id: 'output', label: '成片', dataType: 'video' }],
    createData: () => ({ ...baseData('镜头合成', '合并视频、配音和字幕'), resolution: '1080p' }),
    execute: async ({ inputs, signal, emitProgress, node }) => {
      emitProgress(.35, '对齐轨道');
      await wait(180, signal);
      emitProgress(.8, '导出成片');
      await wait(220, signal);
      return { output: { kind: 'video', video: inputs.video, audio: inputs.audio, resolution: node.data.resolution } };
    },
  },
];

export function registerBuiltinNodes(register: (definition: NodeDefinition) => unknown): void {
  for (const definition of builtinNodeDefinitions) register(definition);
}
