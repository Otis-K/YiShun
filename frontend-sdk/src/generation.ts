import type { CanvasNodeData } from './core/types';

export const GENERATION_MODES = ['text', 'image', 'video', 'audio'] as const;

export type GenerationMode = typeof GENERATION_MODES[number];

export type GenerationMediaKind = 'image' | 'video' | 'audio' | 'text' | 'file';

export interface GenerationMediaReference {
  id: string;
  name: string;
  kind: GenerationMediaKind;
  mimeType?: string;
  url?: string;
  size?: number;
  lastModified?: number;
}

export type GenerationReferenceValue = string | GenerationMediaReference;

/** Gemini 3 Pro Image / Nano Banana Pro accepts at most 14 reference images. */
export const IMAGE_REFERENCE_LIMIT = 14;

export interface TextGenerationDraft {
  prompt: string;
  model: string;
  references: GenerationReferenceValue[];
}

export interface ImageGenerationDraft {
  prompt: string;
  model: string;
  references: GenerationReferenceValue[];
  ratio: string;
  quality: string;
  panorama: boolean;
  count: number;
}

export interface VideoGenerationDraft {
  prompt: string;
  model: string;
  references: GenerationReferenceValue[];
  resolution: string;
  duration: number;
  firstFrame: GenerationReferenceValue | '';
  lastFrame: GenerationReferenceValue | '';
  modeType: string;
  ratio: string;
  enableSound: string;
}

/** Derive the provider mode from the material configuration instead of asking users to keep a second selector in sync. */
export function inferVideoModeType(video: Pick<VideoGenerationDraft, 'references' | 'firstFrame' | 'lastFrame'>): 'text2video' | 'image2video' | 'mixed2video' {
  const kinds = video.references.map(reference => typeof reference === 'string' ? 'file' : reference.kind);
  if (kinds.includes('video')) return 'mixed2video';
  if (video.firstFrame || video.lastFrame) return 'image2video';
  if (!kinds.length) return 'text2video';
  return kinds.includes('image') ? 'image2video' : 'mixed2video';
}

export interface AudioGenerationDraft {
  prompt: string;
  model: string;
  references: GenerationReferenceValue[];
  lyricsMode: string;
}

export interface GenerationDrafts {
  text: TextGenerationDraft;
  image: ImageGenerationDraft;
  video: VideoGenerationDraft;
  audio: AudioGenerationDraft;
}

export interface GenerationNodeData extends CanvasNodeData {
  generationMode: GenerationMode;
  generationDrafts: GenerationDrafts;
}

export interface GenerationModeDescriptor {
  mode: GenerationMode;
  nodeType: string;
  label: string;
  shortLabel: string;
  placeholder: string;
  creditCost: number;
  accept?: string;
}

export const generationModeDescriptors: readonly GenerationModeDescriptor[] = Object.freeze([
  {
    mode: 'text', nodeType: 'prompt', label: '文本生成', shortLabel: '文本',
    placeholder: '输入你的故事、场景或角色设定', creditCost: 1,
    accept: 'text/plain,text/markdown,application/json,.txt,.md,.json',
  },
  {
    mode: 'image', nodeType: 'image', label: '图片生成', shortLabel: '图片',
    placeholder: '描述你想要生成的图片，或输入 @ 引用角色', creditCost: 5,
    accept: 'image/*',
  },
  {
    mode: 'video', nodeType: 'video', label: '视频生成', shortLabel: '视频',
    placeholder: '结合图片，描述你想生成的角色动作和画面动态', creditCost: 20,
    accept: 'image/*,video/*,audio/*',
  },
  {
    mode: 'audio', nodeType: 'audio', label: '音频生成', shortLabel: '音频',
    placeholder: '输入你想要创作的音乐内容', creditCost: 3,
  },
]);

const descriptorByMode = new Map(generationModeDescriptors.map(descriptor => [descriptor.mode, descriptor]));
const descriptorByType = new Map(generationModeDescriptors.map(descriptor => [descriptor.nodeType, descriptor]));

const stringValue = (value: unknown, fallback: string): string => (
  typeof value === 'string' ? value : fallback
);

const integerValue = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

const recordValue = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const mediaKindValue = (value: unknown): GenerationMediaKind => (
  value === 'image' || value === 'video' || value === 'audio' || value === 'text' || value === 'file'
    ? value
    : 'file'
);

const optionalFinite = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

const referenceValue = (value: unknown, fallback: GenerationReferenceValue | '' = ''): GenerationReferenceValue | '' => {
  if (typeof value === 'string') return value;
  const record = recordValue(value);
  if (!Object.keys(record).length) return fallback;
  const name = stringValue(record.name ?? record.title ?? record.fileName, '');
  const id = stringValue(record.id, name);
  if (!id && !name) return fallback;
  const reference: GenerationMediaReference = {
    id: id || name,
    name: name || id,
    kind: mediaKindValue(record.kind ?? record.mediaType),
  };
  const mimeType = stringValue(record.mimeType, '');
  const url = stringValue(record.url ?? record.preview, '');
  const size = optionalFinite(record.size);
  const lastModified = optionalFinite(record.lastModified);
  if (mimeType) reference.mimeType = mimeType;
  if (url) reference.url = url;
  if (size !== undefined) reference.size = size;
  if (lastModified !== undefined) reference.lastModified = lastModified;
  return reference;
};

const referenceList = (value: unknown): GenerationReferenceValue[] => (
  Array.isArray(value)
    ? value.map(item => referenceValue(item)).filter((item): item is GenerationReferenceValue => item !== '').slice(0, IMAGE_REFERENCE_LIMIT)
    : []
);

export function isGenerationMode(value: unknown): value is GenerationMode {
  return typeof value === 'string' && GENERATION_MODES.includes(value as GenerationMode);
}

export function generationModeFromNodeType(type: string): GenerationMode | undefined {
  return descriptorByType.get(type)?.mode;
}

export function generationNodeTypeForMode(mode: GenerationMode): string {
  return descriptorByMode.get(mode)?.nodeType ?? 'prompt';
}

export function isGenerationNodeType(type: string): boolean {
  return descriptorByType.has(type);
}

export function getGenerationModeDescriptor(mode: GenerationMode): GenerationModeDescriptor {
  return descriptorByMode.get(mode) ?? generationModeDescriptors[0];
}

export function createGenerationDrafts(): GenerationDrafts {
  return {
    text: { prompt: '', model: 'GMLM 3.1', references: [] },
    image: {
      prompt: '', model: 'nano-banana-pro(特价版 1)', references: [], ratio: '16:9',
      quality: '标准画质 · 2K', panorama: false, count: 1,
    },
    video: {
      prompt: '', model: 'seedance-2.0-pro(431)', references: [], resolution: '720p', duration: 5,
      firstFrame: '', lastFrame: '', modeType: 'text2video', ratio: '16:9', enableSound: 'off',
    },
    audio: { prompt: '', model: 'Mureka V9', references: [], lyricsMode: '自动生成' },
  };
}

export function normalizeGenerationDrafts(
  value: unknown,
  legacyData: CanvasNodeData = { title: '' },
  activeMode: GenerationMode = 'text',
): GenerationDrafts {
  const source = recordValue(value);
  const defaults = createGenerationDrafts();
  const text = recordValue(source.text);
  const image = recordValue(source.image);
  const video = recordValue(source.video);
  const audio = recordValue(source.audio);
  const legacyPrompt = stringValue(legacyData.prompt, '');
  const legacyModel = stringValue(legacyData.model, '');

  const drafts: GenerationDrafts = {
    text: {
      prompt: stringValue(text.prompt, activeMode === 'text' ? legacyPrompt : defaults.text.prompt),
      model: stringValue(text.model, activeMode === 'text' && legacyModel ? legacyModel : defaults.text.model),
      references: referenceList(text.references),
    },
    image: {
      prompt: stringValue(image.prompt, activeMode === 'image' ? legacyPrompt : defaults.image.prompt),
      model: stringValue(image.model, activeMode === 'image' && legacyModel ? legacyModel : defaults.image.model),
      references: referenceList(image.references),
      ratio: stringValue(image.ratio, stringValue(legacyData.ratio, defaults.image.ratio)),
      quality: stringValue(image.quality, stringValue(legacyData.quality, defaults.image.quality)),
      panorama: typeof image.panorama === 'boolean' ? image.panorama : Boolean(legacyData.panorama),
      count: integerValue(image.count ?? legacyData.count, defaults.image.count, 1, 4),
    },
    video: {
      prompt: stringValue(video.prompt, activeMode === 'video' ? legacyPrompt : defaults.video.prompt),
      model: stringValue(video.model, activeMode === 'video' && legacyModel ? legacyModel : defaults.video.model),
      references: referenceList(video.references),
      resolution: stringValue(video.resolution, stringValue(legacyData.resolution, defaults.video.resolution)),
      duration: integerValue(video.duration ?? legacyData.duration, defaults.video.duration, 4, 15),
      firstFrame: referenceValue(video.firstFrame, referenceValue(legacyData.firstFrame)),
      lastFrame: referenceValue(video.lastFrame, referenceValue(legacyData.lastFrame)),
      modeType: stringValue(video.modeType, stringValue(legacyData.modeType, defaults.video.modeType)),
      ratio: stringValue(video.ratio, stringValue(legacyData.ratio, defaults.video.ratio)),
      enableSound: stringValue(video.enableSound, stringValue(legacyData.enableSound, defaults.video.enableSound)),
    },
    audio: {
      prompt: stringValue(audio.prompt, activeMode === 'audio' ? legacyPrompt : defaults.audio.prompt),
      model: stringValue(audio.model, activeMode === 'audio' && legacyModel ? legacyModel : defaults.audio.model),
      references: referenceList(audio.references),
      lyricsMode: stringValue(audio.lyricsMode, stringValue(legacyData.lyricsMode, defaults.audio.lyricsMode)),
    },
  };
  return drafts;
}

export function generationDataPatch(
  mode: GenerationMode,
  drafts: GenerationDrafts,
): Partial<GenerationNodeData> {
  const normalizedDrafts = structuredClone(drafts);
  normalizedDrafts.video.modeType = inferVideoModeType(normalizedDrafts.video);
  const draft = normalizedDrafts[mode];
  const patch: Partial<GenerationNodeData> = {
    generationMode: mode,
    generationDrafts: normalizedDrafts,
    prompt: draft.prompt,
    model: draft.model,
  };
  if (mode === 'image') Object.assign(patch, {
    ratio: drafts.image.ratio,
    quality: drafts.image.quality,
    panorama: drafts.image.panorama,
    count: drafts.image.count,
  });
  if (mode === 'video') Object.assign(patch, {
    resolution: normalizedDrafts.video.resolution,
    duration: normalizedDrafts.video.duration,
    firstFrame: normalizedDrafts.video.firstFrame,
    lastFrame: normalizedDrafts.video.lastFrame,
    modeType: normalizedDrafts.video.modeType,
    ratio: normalizedDrafts.video.ratio,
    enableSound: normalizedDrafts.video.enableSound,
  });
  if (mode === 'audio') Object.assign(patch, { lyricsMode: drafts.audio.lyricsMode });
  return patch;
}

export function generationCreditCost(mode: GenerationMode, drafts: GenerationDrafts): number {
  const base = getGenerationModeDescriptor(mode).creditCost;
  return mode === 'image' ? base * drafts.image.count : base;
}
