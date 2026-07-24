import { useEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AudioLines,
  ArrowRight,
  ArrowUp,
  AtSign,
  Check,
  ChevronDown,
  Clapperboard,
  Download,
  FileUp,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MousePointer2,
  Plus,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { MutationOptions } from '../core/engine';
import type { CanvasNodeData, GraphDocument, NodeDefinition } from '../core/types';
import {
  GENERATION_MODES,
  IMAGE_REFERENCE_LIMIT,
  generationCreditCost,
  generationDataPatch,
  generationModeFromNodeType,
  getGenerationModeDescriptor,
  isGenerationMode,
  normalizeGenerationDrafts,
  type GenerationDrafts,
  type GenerationMediaKind,
  type GenerationMediaReference,
  type GenerationMode,
  type GenerationReferenceValue,
} from '../generation';
import type { FlowCanvasReadonlyNode } from './extensions';
import { VideoPreview } from './VideoPreview';

export interface GenerationReference {
  id: string;
  title: string;
  type: string;
  status?: string;
  prompt?: string;
  preview?: string;
  kind?: GenerationMediaKind;
  mimeType?: string;
  sourceNodeId?: string;
  targetPort?: string;
  connected?: boolean;
}

interface GenerationNodePanelProps {
  node: FlowCanvasReadonlyNode;
  definition: NodeDefinition;
  readOnly: boolean;
  running: boolean;
  onUpdateData: (patch: Partial<CanvasNodeData>, options?: MutationOptions) => void;
  onCaptureSnapshot: () => GraphDocument;
  onCommitSnapshot: (label: string, before: GraphDocument) => void;
  onDraftChange: (active: boolean, commit?: () => void) => void;
  onChangeMode: (mode: GenerationMode) => void;
  onRun: () => void;
  onCancel: () => void;
  onNotify: (message: string) => void;
  getReferences: () => GenerationReference[];
  connectedReferences: GenerationReference[];
  onDisconnectReference: (sourceNodeId: string, targetPort?: string, edgeId?: string) => void;
}

const statusLabels: Record<string, string> = {
  idle: '待生成', queued: '排队中', running: '生成中', success: '已完成', succeeded: '已完成', completed: '已完成', error: '失败', cancelled: '已取消',
};
const isSuccessfulReference = (status?: string): boolean => ['success', 'succeeded', 'completed', 'complete'].includes(String(status ?? '').toLowerCase());
const VIDEO_REFERENCE_LIMIT = 24;

const modelOptions: Record<GenerationMode, readonly string[]> = {
  text: ['GMLM 3.1', 'DeepSeek V3', 'Qwen Max'],
  image: ['nano-banana-pro(特价版 1)'],
  video: ['seedance-2.0-pro(431)'],
  audio: ['Mureka V9', 'Suno V4', 'Eleven Music'],
};

const modelDescriptions: Record<string, string> = {
  'GMLM 3.1': '极致推理，全能文本模型 Pro',
  'DeepSeek V3': '深度推理与复杂内容创作',
  'Qwen Max': '通义千问旗舰文本模型',
  'nano-banana-pro(特价版 1)': '支持 1K、2K、4K 与多种画幅的图片生成模型',
  '即梦图片 3.0': '中文创意与商业视觉生成',
  'Flux 1.1': '写实细节与构图增强模型',
  'Vidu Q2': '高一致性图生视频模型',
  'Kling 2.1': '复杂运动与镜头语言增强',
  'Seedance 1.0': '多镜头叙事视频生成模型',
  'seedance-2.0-fast': 'Seedance 2.0 稳定快速渠道，支持全参数视频生成',
  'seedance-2.0-pro(431)': 'Seedance 2.0 Pro 特价渠道，固定 720p，支持首尾帧与多模态参考',
  'Mureka V9': '歌曲、配乐与人声生成模型',
  'Suno V4': '完整音乐与歌词创作模型',
  'Eleven Music': '高品质音乐与音效生成模型',
};

const modelDisplayNames: Record<string, string> = {
  'nano-banana-pro(特价版 1)': 'Nano Banana Pro',
  'seedance-2.0-fast': 'Seedance 2.0 Fast',
  'seedance-2.0-pro(431)': 'Seedance 2.0 Pro (431)',
};

const modelBadges: Record<string, readonly string[]> = {
  'nano-banana-pro(特价版 1)': ['4K', '支持 14 个参考'],
  'seedance-2.0-fast': ['720P', '4–15 秒', '支持混合素材'],
  'seedance-2.0-pro(431)': ['固定 720P', '4–15 秒', '4 图 / 3 视频 / 1 音频'],
  'GMLM 3.1': ['长文本', '推理'],
  'DeepSeek V3': ['推理', '中文'],
  'Qwen Max': ['长文本', '多语言'],
  'Mureka V9': ['音乐', '人声'],
  'Suno V4': ['歌曲', '歌词'],
  'Eleven Music': ['音乐', '音效'],
};

const modelDisplayName = (value: string): string => modelDisplayNames[value] ?? value;

interface ParameterSelectProps {
  label: string;
  value: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (value: string) => void;
  size?: 'compact' | 'medium' | 'wide';
}

const parameterOptionLabels: Record<string, Record<string, string>> = {
  '生成模式': { text2video: '文生视频', image2video: '图生视频 / 首尾帧', mixed2video: '参考生视频' },
  '生成声音': { off: '关闭声音', on: '生成声音' },
};

const parameterOptionDetails: Record<string, Record<string, string>> = {
  '生成模式': {
    text2video: '只提交提示词，不携带任何素材',
    image2video: '首帧可单独使用；尾帧需与首帧配对，不能混入参考素材',
    mixed2video: '参考素材最多 4 张图片、3 个视频、1 段音频',
  },
  '视频分辨率': { '480p': '旧 Seedance 渠道低成本输出', '720p': 'Seedance Pro(431) 当前唯一支持的分辨率' },
  '视频时长': Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`${index + 4}秒`, `Seedance 支持 ${index + 4} 秒视频`])),
  '生成声音': { off: '不生成音轨', on: '仅旧 Seedance 渠道支持' },
  '图片画质': { '标准画质 · 1K': 'Nano Banana Pro 支持', '标准画质 · 2K': 'Nano Banana Pro 支持', '高清画质 · 4K': 'Nano Banana Pro 支持' },
};

const optionLabel = (label: string, value: string) => parameterOptionLabels[label]?.[value] ?? value;

function ParameterSelect({ label, value, options, disabled, onChange, size = 'medium' }: ParameterSelectProps) {
  const [open, setOpen] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('pointerdown', dismiss, true);
    return () => window.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  const selectMenu = open && portalRoot ? createPortal(<div ref={menu} className="fc-generation-select__menu fc-generation-select__menu--floating nodrag nowheel" style={menuPosition} role="listbox" aria-label={`${label}选项`}>
    <header><strong>{label}</strong><small>选项按当前模型 API 能力提供</small></header>
    {options.map(option => <button type="button" role="option" aria-selected={option === value} className={option === value ? 'is-selected' : ''} key={option} onClick={event => { event.stopPropagation(); onChange(option); setOpen(false); }}>
      <span><strong>{optionLabel(label, option)}</strong><small>{parameterOptionDetails[label]?.[option] ?? `提交参数：${option}`}</small></span>{option === value && <Check size={14} />}
    </button>)}
  </div>, portalRoot) : null;
  return <><div ref={root} className={`fc-generation-select fc-generation-select--${size} nodrag nowheel${open ? ' is-open' : ''}`}>
    <button type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} title={`${label}：${optionLabel(label, value)}`} onClick={event => {
      event.stopPropagation();
      if (open) { setOpen(false); return; }
      const sdkRoot = event.currentTarget.closest('.fc-sdk') as HTMLElement | null;
      if (sdkRoot) {
        const sdkRect = sdkRoot.getBoundingClientRect();
        const anchorRect = event.currentTarget.getBoundingClientRect();
        const menuHeight = Math.min(360, 72 + options.length * 50);
        const above = anchorRect.top - sdkRect.top - menuHeight - 6;
        setPortalRoot(sdkRoot);
        setMenuPosition({ left: Math.max(12, Math.min(anchorRect.left - sdkRect.left, sdkRect.width - 312)), top: above >= 12 ? above : anchorRect.bottom - sdkRect.top + 6 });
      }
      setOpen(true);
    }}>
      <span>{optionLabel(label, value)}</span><ChevronDown size={12} />
    </button>
  </div>{selectMenu}</>;
}

function ModelSelect({ label, value, options, disabled, onChange }: ParameterSelectProps) {
  const [open, setOpen] = useState(false);
  return <div
    className={`fc-model-select nodrag nowheel${open ? ' is-open' : ''}`}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}
  >
    <button
      className="fc-model-select__trigger"
      type="button"
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      disabled={disabled}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); setOpen(current => !current); }}
    >
      <Sparkles size={14} /><span title={value}>{modelDisplayName(value)}</span><ChevronDown size={13} />
    </button>
    <div className="fc-model-select__menu" role="listbox" aria-label={`${label}选项`} hidden={!open}>
      {options.map((option, index) => <button
        type="button"
        role="option"
        aria-selected={option === value}
        className={option === value ? 'is-selected' : ''}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onChange(option); setOpen(false); }}
        key={option}
      >
        <span className="fc-model-select__mark">{index === 2 ? <small>万相</small> : <Sparkles size={17} />}</span>
        <span className="fc-model-select__copy"><strong>{modelDisplayName(option)}</strong><small>{modelDescriptions[option] ?? '智能生成模型'}</small><span className="fc-model-select__badges">{(modelBadges[option] ?? []).map(badge => <i key={badge}>{badge}</i>)}</span></span>
        {option === value && <Check className="fc-model-select__check" size={17} />}
      </button>)}
    </div>
  </div>;
}

const activeModeOf = (node: FlowCanvasReadonlyNode): GenerationMode => {
  const explicit = node.data.generationMode;
  if (isGenerationMode(explicit)) return explicit;
  return generationModeFromNodeType(node.type) ?? 'text';
};

const mediaKindFromMime = (mimeType: string): GenerationMediaKind => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/')) return 'text';
  return 'file';
};

const createObjectUrl = (file: File): string => {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
  try {
    return URL.createObjectURL(file);
  } catch {
    return '';
  }
};

const createMediaReference = (file: File): GenerationMediaReference => {
  const mimeType = file.type || 'application/octet-stream';
  const url = createObjectUrl(file);
  const reference: GenerationMediaReference = {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    kind: mediaKindFromMime(mimeType),
    mimeType,
    size: Number.isFinite(file.size) ? file.size : 0,
    lastModified: Number.isFinite(file.lastModified) ? file.lastModified : 0,
  };
  if (url) reference.url = url;
  return reference;
};

const referenceKey = (reference: GenerationReferenceValue): string => (
  typeof reference === 'string' ? reference : reference.id || reference.name
);

const referenceLabel = (reference: GenerationReferenceValue): string => (
  typeof reference === 'string' ? reference : reference.name || reference.id
);

const referenceUrl = (reference: GenerationReferenceValue | ''): string => (
  typeof reference === 'string' ? '' : reference.url ?? ''
);

const referenceKind = (reference: GenerationReferenceValue | ''): GenerationMediaKind | undefined => (
  typeof reference === 'string' ? undefined : reference.kind
);

const referenceMimeType = (reference: GenerationReferenceValue | ''): string => (
  typeof reference === 'string' ? '' : reference.mimeType ?? ''
);

const mergeReferences = (
  existing: readonly GenerationReferenceValue[],
  incoming: readonly GenerationReferenceValue[],
  limit = 24,
): GenerationReferenceValue[] => {
  const map = new Map<string, GenerationReferenceValue>();
  for (const reference of [...existing, ...incoming]) {
    const key = referenceKey(reference);
    if (key) map.set(key, reference);
  }
  return [...map.values()].slice(0, limit);
};

const previewPatchFor = (
  references: readonly GenerationReferenceValue[],
  firstFrame: GenerationReferenceValue | '',
  lastFrame: GenerationReferenceValue | '',
  currentPreview = '',
  removedUrl = '',
): Partial<CanvasNodeData> => {
  if (!currentPreview || (removedUrl && currentPreview !== removedUrl)) return {};
  const replacement = [firstFrame, lastFrame, ...references]
    .find(reference => referenceUrl(reference) && referenceUrl(reference) !== removedUrl) ?? '';
  if (!replacement) return { preview: '', previewKind: '', mimeType: '', fileName: '' };
  return {
    preview: referenceUrl(replacement),
    previewKind: referenceKind(replacement) ?? '',
    mimeType: referenceMimeType(replacement),
    fileName: referenceLabel(replacement),
  };
};

function MediaPreview({ source, kind, alt }: { source: string; kind?: GenerationMediaKind; alt: string }) {
  if (kind === 'video') {
    return <VideoPreview src={source} title={alt} className="fc-generation-node__video-preview" />;
  }
  if (kind === 'audio') {
    return <div className="fc-generation-node__audio-preview nodrag nowheel"><audio src={source} controls preload="metadata" aria-label={alt} /></div>;
  }
  return <img src={source} alt={alt} />;
}

function ReferenceChipPreview({ reference }: { reference: GenerationReferenceValue }) {
  const source = referenceUrl(reference);
  const kind = referenceKind(reference);
  if (source && kind === 'image') return <img src={source} alt="" />;
  if (source && kind === 'video') return <video src={source} muted preload="metadata" aria-hidden="true" />;
  if (kind === 'video') return <Clapperboard aria-hidden="true" size={13} />;
  if (kind === 'audio') return <AudioLines aria-hidden="true" size={13} />;
  if (kind === 'image') return <ImageIcon aria-hidden="true" size={13} />;
  return <AtSign aria-hidden="true" size={13} />;
}

export function GenerationNodePanel({
  node,
  definition,
  readOnly,
  running,
  onUpdateData,
  onCaptureSnapshot,
  onCommitSnapshot,
  onDraftChange,
  onChangeMode,
  onRun,
  onCancel,
  onNotify,
  getReferences,
  connectedReferences,
  onDisconnectReference,
}: GenerationNodePanelProps) {
  const mode = activeModeOf(node);
  const drafts = normalizeGenerationDrafts(node.data.generationDrafts, node.data, mode);
  const draft = drafts[mode];
  const descriptor = getGenerationModeDescriptor(mode);
  const status = typeof node.data.status === 'string' ? node.data.status : 'idle';
  const preview = typeof node.data.preview === 'string' ? node.data.preview : '';
  const previewKind = node.data.previewKind === 'video' || node.data.previewKind === 'audio' || node.data.previewKind === 'image'
    ? node.data.previewKind
    : undefined;
  const [expanded, setExpanded] = useState(false);
  const [referencePicker, setReferencePicker] = useState<'asset' | 'mention' | null>(null);
  const [assetTab, setAssetTab] = useState<'image' | 'video'>('image');
  const [referenceTarget, setReferenceTarget] = useState<'reference' | 'firstFrame' | 'lastFrame'>('reference');
  const [referenceOverflowOpen, setReferenceOverflowOpen] = useState(false);
  const [previewReference, setPreviewReference] = useState<GenerationReferenceValue | null>(null);
  const [floatingPosition, setFloatingPosition] = useState({ left: 0, top: 0 });
  const [referenceQuery, setReferenceQuery] = useState('');
  const [promptDraft, setPromptDraft] = useState(draft.prompt);
  const uploadInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const nodePanel = useRef<HTMLDivElement>(null);
  const pendingUploadSlot = useRef<'reference' | 'firstFrame' | 'lastFrame'>('reference');
  const promptEditing = useRef(false);
  const promptComposing = useRef(false);
  const promptSnapshot = useRef<GraphDocument | undefined>(undefined);

  useEffect(() => {
    // While the textarea owns the edit, its local value is authoritative. In
    // particular, graph notifications must not replace an in-progress IME
    // composition with the last committed prompt.
    if (!promptEditing.current && !promptComposing.current) setPromptDraft(draft.prompt);
  }, [draft.prompt, mode, node.id]);

  useEffect(() => {
    const textarea = promptInput.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(64, textarea.scrollHeight)}px`;
  }, [promptDraft, mode]);

  useEffect(() => {
    if (!referencePicker && !referenceOverflowOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (nodePanel.current?.contains(target)) return;
      const owner = target?.closest('[data-flowcanvas-floating-owner]');
      if (owner?.getAttribute('data-flowcanvas-floating-owner') === node.id) return;
      setReferencePicker(null);
      setReferenceOverflowOpen(false);
    };
    window.addEventListener('pointerdown', dismiss, true);
    return () => window.removeEventListener('pointerdown', dismiss, true);
  }, [referencePicker, referenceOverflowOpen, node.id]);

  const updateDraft = (
    patch: Record<string, unknown>,
    dataPatch: Partial<CanvasNodeData> = {},
    options?: MutationOptions,
  ) => {
    const nextDrafts = structuredClone(drafts) as GenerationDrafts;
    Object.assign(nextDrafts[mode], patch);
    onUpdateData({
      ...generationDataPatch(mode, nextDrafts),
      status: 'idle',
      progress: 0,
      runMessage: '',
      runError: '',
      ...dataPatch,
    }, options);
  };

  const commitPromptDraft = () => {
    if (!promptEditing.current) return;
    promptEditing.current = false;
    promptComposing.current = false;
    const before = promptSnapshot.current;
    promptSnapshot.current = undefined;
    if (before) onCommitSnapshot('编辑生成提示词', before);
    onDraftChange(false);
  };

  const beginPromptDraft = () => {
    if (readOnly || promptEditing.current) return;
    promptEditing.current = true;
    promptSnapshot.current = onCaptureSnapshot();
    onDraftChange(true, commitPromptDraft);
  };

  const updatePromptDraft = (value: string) => {
    if (readOnly) return;
    beginPromptDraft();
    setPromptDraft(value);
    updateDraft({ prompt: value }, {}, { record: false, transient: true });
  };

  const finishPromptComposition = (event: CompositionEvent<HTMLTextAreaElement>) => {
    promptComposing.current = false;
    // React/browser pairs normally deliver an onChange with compositionend,
    // but syncing the final DOM value here also covers IMEs which do not.
    if (event.currentTarget.value !== promptDraft) updatePromptDraft(event.currentTarget.value);
  };

  const requestUpload = (slot: 'reference' | 'firstFrame' | 'lastFrame' = 'reference') => {
    if (readOnly) return;
    pendingUploadSlot.current = slot;
    uploadInput.current?.click();
  };

  const positionFloatingPanel = (anchor: HTMLElement, width = 460) => {
    const root = anchor.closest('.fc-sdk') as HTMLElement | null;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const right = anchorRect.right - rootRect.left + 12;
    const left = right + width <= rootRect.width - 12
      ? right
      : Math.max(12, anchorRect.left - rootRect.left - width - 12);
    const top = Math.max(12, Math.min(anchorRect.top - rootRect.top - 8, rootRect.height - 590));
    setFloatingPosition({ left, top });
  };

  const toggleReferencePicker = (kind: 'asset' | 'mention', anchor: HTMLElement, target: 'reference' | 'firstFrame' | 'lastFrame' = 'reference') => {
    if (referencePicker === kind && referenceTarget === target) { setReferencePicker(null); return; }
    positionFloatingPanel(anchor);
    setReferenceOverflowOpen(false);
    setReferenceQuery('');
    if (kind === 'asset') setAssetTab('image');
    setReferenceTarget(target);
    setReferencePicker(kind);
  };

  const uploaded = (event: ChangeEvent<HTMLInputElement>) => {
    const slot = pendingUploadSlot.current;
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!selectedFiles.length) return;
    const files = mode === 'video' && slot !== 'reference'
      ? selectedFiles.filter(file => (file.type || '').startsWith('image/')).slice(0, 1)
      : selectedFiles.filter(file => /^(image|video|audio)\//.test(file.type || '') || mode !== 'video');
    if (!files.length) {
      onNotify(slot === 'reference' ? '参考素材仅支持图片、视频或音频' : '首帧和尾帧必须选择图片');
      return;
    }
    const referenceLimit = mode === 'image' ? IMAGE_REFERENCE_LIMIT : VIDEO_REFERENCE_LIMIT;
    const available = Math.max(0, referenceLimit - draft.references.length);
    const assets = files.map(createMediaReference).slice(0, slot === 'reference' ? available : 1);
    if (!assets.length) {
      onNotify(`当前模型最多支持 ${referenceLimit} 个参考素材`);
      return;
    }
    const names = assets.map(asset => asset.name);
    const firstAsset = assets[0];
    const nextPreview = firstAsset?.url
      ? { preview: firstAsset.url, previewKind: firstAsset.kind, mimeType: firstAsset.mimeType, fileName: firstAsset.name }
      : {};
    if (mode === 'video' && slot !== 'reference') {
      updateDraft({ [slot]: firstAsset ?? names[0] ?? '', modeType: drafts.video.modeType === 'mixed2video' ? 'mixed2video' : 'image2video' });
    } else if (mode === 'video') {
      const requiresMixedMode = assets.some(asset => asset.kind === 'video' || asset.kind === 'audio');
      updateDraft({ references: mergeReferences(draft.references, assets), modeType: requiresMixedMode ? 'mixed2video' : drafts.video.modeType === 'text2video' ? 'image2video' : drafts.video.modeType }, nextPreview);
    } else updateDraft({ references: mergeReferences(draft.references, assets, referenceLimit) }, nextPreview);
    if (selectedFiles.length > assets.length) onNotify(`已达到当前模型的 ${referenceLimit} 个参考素材上限`);
    onNotify(`已添加 ${names.length} 个本地素材引用`);
  };

  const referenceFromNode = (reference: GenerationReference): GenerationMediaReference => ({
    id: `node:${reference.sourceNodeId || reference.id}`,
    name: reference.title,
    kind: reference.kind ?? 'file',
    mimeType: reference.mimeType,
    url: reference.preview,
  });

  const canUseAssetReference = (reference: GenerationReference) => {
    if (referenceTarget === 'firstFrame' || referenceTarget === 'lastFrame') return reference.kind === 'image';
    if (mode === 'image') return reference.kind === 'image';
    return reference.kind === 'image' || reference.kind === 'video' || reference.kind === 'audio';
  };

  const exportReference = async (reference: GenerationReference) => {
    if (!reference.preview) return;
    const extension = reference.kind === 'video' ? 'mp4' : reference.kind === 'audio' ? 'mp3' : 'png';
    const safeName = (reference.title || `flowcanvas-${reference.kind || 'asset'}`).replace(/[\\/:*?\"<>|]/g, '_');
    const anchor = document.createElement('a');
    anchor.download = safeName.toLowerCase().endsWith(`.${extension}`) ? safeName : `${safeName}.${extension}`;
    try {
      const response = await fetch(reference.preview);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blobUrl = URL.createObjectURL(await response.blob());
      anchor.href = blobUrl;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      anchor.href = reference.preview;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.click();
    }
    onNotify(`已导出素材：${reference.title}`);
  };

  const selectAssetReference = (reference: GenerationReference) => {
    if (!canUseAssetReference(reference)) {
      onNotify(referenceTarget === 'reference' ? '当前节点不支持使用这种素材' : '首帧和尾帧只能选择图片素材');
      return;
    }
    const mediaReference = referenceFromNode(reference);
    if (mode === 'video' && (referenceTarget === 'firstFrame' || referenceTarget === 'lastFrame')) {
      if (mediaReference.kind !== 'image') {
        onNotify('首帧和尾帧只能选择图片素材');
        return;
      }
      updateDraft(
        { [referenceTarget]: mediaReference, modeType: 'image2video' },
      );
    } else {
      const nextMode = mode === 'video'
        ? (mediaReference.kind === 'video' || mediaReference.kind === 'audio' ? 'mixed2video' : drafts.video.modeType === 'text2video' ? 'image2video' : drafts.video.modeType)
        : undefined;
      updateDraft({
        references: mergeReferences(draft.references, [mediaReference], mode === 'image' ? IMAGE_REFERENCE_LIMIT : VIDEO_REFERENCE_LIMIT),
        ...(nextMode ? { modeType: nextMode } : {}),
      });
    }
    setReferencePicker(null);
    onNotify(`已添加画布素材：${reference.title}`);
  };

  const mentionReference = (reference: GenerationReference) => {
    const semantic = String(reference.prompt || '').trim();
    const marker = semantic ? `@${reference.title}「${semantic}」` : `@${reference.title}`;
    const nextReferences = reference.preview && reference.kind
      ? mergeReferences(draft.references, [referenceFromNode(reference)], mode === 'image' ? IMAGE_REFERENCE_LIMIT : VIDEO_REFERENCE_LIMIT)
      : draft.references;
    updateDraft({
      references: nextReferences,
      prompt: `${draft.prompt.trimEnd()}${draft.prompt.trim() ? ' ' : ''}${marker} `,
    });
    setReferencePicker(null);
    onNotify(`已在提示词中引用：${reference.title}`);
  };

  const removeReference = (reference: GenerationReferenceValue) => {
    if (readOnly) return;
    const removedUrl = referenceUrl(reference);
    const remaining = draft.references.filter(item => referenceKey(item) !== referenceKey(reference));
    updateDraft(
      { references: remaining },
      previewPatchFor(remaining, drafts.video.firstFrame, drafts.video.lastFrame, preview, removedUrl),
    );
    if (removedUrl.startsWith('blob:') && typeof URL !== 'undefined') {
      try { URL.revokeObjectURL(removedUrl); } catch { /* ignore renderer URL cleanup failures */ }
    }
    onNotify(`已移除素材：${referenceLabel(reference)}`);
  };

  const clearVideoFrame = (slot: 'firstFrame' | 'lastFrame') => {
    if (readOnly) return;
    const removed = drafts.video[slot];
    if (!removed) return;
    const removedUrl = referenceUrl(removed);
    const legacyFramePreview = previewKind === 'image' && Boolean(removedUrl) && preview === removedUrl;
    updateDraft({ [slot]: '' }, legacyFramePreview ? { preview: '', previewKind: '', mimeType: '', fileName: '' } : {});
    const connected = connectedKeys.get(referenceKey(removed));
    if (connected?.sourceNodeId) onDisconnectReference(connected.sourceNodeId, connected.targetPort, connected.id);
    if (removedUrl.startsWith('blob:') && typeof URL !== 'undefined') {
      try { URL.revokeObjectURL(removedUrl); } catch { /* ignore renderer URL cleanup failures */ }
    }
    onNotify(`已移除${slot === 'firstFrame' ? '首帧' : '尾帧'}素材${connected ? '并断开对应连线' : ''}`);
  };

  const parameterModel = (value: string) => updateDraft(value === 'seedance-2.0-pro(431)'
    ? { model: value, resolution: '720p', ratio: ['16:9', '9:16', '1:1'].includes(drafts.video.ratio) ? drafts.video.ratio : '16:9', enableSound: 'off' }
    : { model: value });
  const promptReady = draft.prompt.trim().length > 0;
  const nodeRunning = status === 'running' || status === 'queued';
  const references = referencePicker
    ? getReferences().filter(reference => reference.id !== node.id)
    : [];
  const selectableReferences = references.filter(reference => {
    if (referencePicker === 'mention') return true;
    if (!isSuccessfulReference(reference.status) || !reference.preview || !reference.kind) return false;
    return reference.kind === assetTab;
  }).filter(reference => {
    const query = referenceQuery.trim().toLowerCase();
    return !query || `${reference.title} ${reference.prompt || ''}`.toLowerCase().includes(query);
  });
  const connectedKeys = new Map(connectedReferences.map(reference => [`node:${reference.sourceNodeId || reference.id}`, reference]));
  const isPro431 = mode === 'video' && drafts.video.model === 'seedance-2.0-pro(431)';
  const connectedMediaReferences = connectedReferences
    .filter(reference => isSuccessfulReference(reference.status) && reference.preview && reference.kind)
    .map(reference => referenceFromNode(reference));
  const visibleReferences = mergeReferences(draft.references, connectedMediaReferences, 24);
  const effectiveFirstFrame = drafts.video.firstFrame;
  const effectiveLastFrame = drafts.video.lastFrame;
  const nodeClass = `fc-generation-node${expanded ? ' is-expanded' : ''}`;
  const firstMediaReference = draft.references.find(reference => typeof reference !== 'string' && reference.url);
  const generatedPreview = mode === 'video' && previewKind === 'image' ? '' : preview;
  const previewSource = generatedPreview || (mode === 'video' ? '' : referenceUrl(firstMediaReference ?? ''));
  const previewMediaKind = generatedPreview ? previewKind : (mode === 'video' ? undefined : referenceKind(firstMediaReference ?? ''));
  const floatingRoot = nodePanel.current?.closest('.fc-sdk') as HTMLElement | null;
  const mediaPreviewPanel = previewReference && floatingRoot ? createPortal(<div
    className="fc-generation-media-preview-backdrop nodrag nowheel"
    data-flowcanvas-floating-owner={node.id}
    role="dialog"
    aria-label="素材预览"
    onPointerDown={() => setPreviewReference(null)}
  >
    <article onPointerDown={event => event.stopPropagation()}>
      <button type="button" aria-label="关闭素材预览" onClick={() => setPreviewReference(null)}><X size={18} /></button>
      <div className="fc-generation-media-preview-content">
        <MediaPreview source={referenceUrl(previewReference)} kind={referenceKind(previewReference)} alt={referenceLabel(previewReference)} />
      </div>
      <strong>{referenceLabel(previewReference)}</strong>
    </article>
  </div>, floatingRoot) : null;
  const referencePanel = referencePicker && floatingRoot ? createPortal(<div
    className="fc-generation-reference-popover fc-generation-floating-panel nodrag nowheel"
    style={floatingPosition}
    data-flowcanvas-floating-owner={node.id}
    role="listbox"
    aria-label={referencePicker === 'asset' ? '选择画布素材' : '插入节点引用'}
  >
    <header>
      <strong>{referencePicker === 'asset' ? '选择画布素材' : '插入 @ 节点引用'}</strong>
      <small>{referencePicker === 'asset' ? '加入参考素材，不改写提示词' : '插入节点上下文；媒体节点同时加入素材'}</small>
      {referencePicker === 'asset' && <div className="fc-generation-reference-tabs" role="tablist" aria-label="素材类型">
        <button type="button" role="tab" aria-selected={assetTab === 'image'} onClick={() => setAssetTab('image')}><ImageIcon size={14} />图片</button>
        <button type="button" role="tab" aria-selected={assetTab === 'video'} onClick={() => setAssetTab('video')}><Clapperboard size={14} />视频</button>
      </div>}
      <input aria-label="搜索画布节点" value={referenceQuery} onChange={event => setReferenceQuery(event.target.value)} placeholder="搜索节点名称或提示词" />
    </header>
    <div className="fc-generation-reference-popover__grid">
    {selectableReferences.length ? selectableReferences.map(reference => {
      const candidateKey = `node:${reference.sourceNodeId || reference.id}`;
      const selected = referenceTarget === 'firstFrame'
        ? referenceKey(effectiveFirstFrame) === candidateKey
        : referenceTarget === 'lastFrame'
          ? referenceKey(effectiveLastFrame) === candidateKey
          : visibleReferences.some(item => referenceKey(item) === candidateKey);
      const usable = canUseAssetReference(reference);
      const media = <>
        <span className="fc-generation-reference-popover__thumb">{reference.preview && reference.kind === 'image' ? <img src={reference.preview} alt="" /> : reference.preview && reference.kind === 'video' ? <video src={reference.preview} muted preload="metadata" aria-hidden="true" /> : reference.kind === 'image' ? <ImageIcon size={16} /> : reference.kind === 'video' ? <Clapperboard size={16} /> : reference.kind === 'audio' ? <AudioLines size={16} /> : <AtSign size={16} />}</span>
        <span className="fc-generation-reference-popover__copy"><strong>{reference.title}</strong><small>{reference.kind} · {statusLabels[reference.status || 'idle'] ?? reference.status ?? '待生成'}</small></span>
        {reference.prompt && <span className="fc-generation-material-tooltip" role="tooltip">{reference.prompt}</span>}
      </>;
      if (referencePicker === 'mention') return <button type="button" role="option" aria-selected={selected} className="fc-generation-reference-card" key={reference.id} onClick={() => mentionReference(reference)}>{media}<span className="fc-generation-reference-popover__state">{selected ? <Check size={14} /> : `#${reference.id.slice(-5)}`}</span></button>;
      return <article role="option" aria-selected={selected} className="fc-generation-reference-card" key={reference.id}>
        <button className="fc-generation-reference-card__preview" type="button" aria-label={`预览素材 ${reference.title}`} onClick={() => setPreviewReference(referenceFromNode(reference))}>{media}</button>
        <button className="fc-generation-reference-card__export" type="button" aria-label={`导出素材 ${reference.title}`} title="导出素材" onClick={() => void exportReference(reference)}><Download size={13} /></button>
        <button className="fc-generation-reference-card__use" type="button" aria-label={`使用素材 ${reference.title}`} title={usable ? '使用素材' : '当前节点不支持此素材类型'} disabled={!usable} onClick={() => selectAssetReference(reference)}>{selected ? <Check size={13} /> : <Plus size={13} />}</button>
      </article>;
    }) : <p>{referencePicker === 'asset' ? `当前画布暂无可用${assetTab === 'image' ? '图片' : '视频'}素材` : '没有匹配的画布节点'}</p>}
    </div>
    {referencePicker === 'asset' && <button className="fc-generation-reference-popover__upload" type="button" onClick={() => { setReferencePicker(null); requestUpload(referenceTarget); }}>
      <span className="fc-generation-reference-popover__thumb"><Upload size={16} /></span>
      <span className="fc-generation-reference-popover__copy"><strong>上传本地素材</strong><small>{referenceTarget === 'reference' ? '支持图片、视频和音频' : '首帧/尾帧仅支持图片'}</small></span>
      <Plus size={14} />
    </button>}
  </div>, floatingRoot) : null;
  const overflowPanel = referenceOverflowOpen && floatingRoot ? createPortal(<div
    className="fc-generation-reference-popover fc-generation-reference-library fc-generation-floating-panel nodrag nowheel"
    style={floatingPosition}
    data-flowcanvas-floating-owner={node.id}
    role="dialog"
    aria-label="全部参考素材"
  >
    <header><strong>全部参考素材</strong><small>共 {visibleReferences.length} 项，可在这里预览或移除</small></header>
    <div className="fc-generation-reference-library__grid">
      {visibleReferences.map(reference => {
        const connected = connectedKeys.get(referenceKey(reference));
        return <article key={referenceKey(reference)}>
          <span><ReferenceChipPreview reference={reference} /></span>
          <strong title={referenceLabel(reference)}>{referenceLabel(reference)}</strong>
          <button type="button" aria-label={`移除素材 ${referenceLabel(reference)}`} disabled={readOnly} onClick={() => connected?.sourceNodeId ? onDisconnectReference(connected.sourceNodeId, connected.targetPort, connected.id) : removeReference(reference)}><X size={12} /></button>
        </article>;
      })}
    </div>
  </div>, floatingRoot) : null;

  const referenceChips = visibleReferences.length > 0 && <div className="fc-generation-reference-chips" aria-label="已选参考素材">
    <div className="fc-generation-reference-chips__list">
      {visibleReferences.slice(0, 3).map(reference => {
        const connected = connectedKeys.get(referenceKey(reference));
        const prompt = connected?.prompt || '';
        return <span className={`fc-generation-reference-chip${connected ? ' is-connected' : ''}`} title={referenceLabel(reference)} key={referenceKey(reference)}>
          <span className="fc-generation-reference-chip__preview"><ReferenceChipPreview reference={reference} /></span>
          <button type="button" aria-label={`移除素材 ${referenceLabel(reference)}`} disabled={readOnly} onClick={() => connected?.sourceNodeId ? onDisconnectReference(connected.sourceNodeId, connected.targetPort, connected.id) : removeReference(reference)}><X size={10} /></button>
          {prompt && <span className="fc-generation-material-tooltip" role="tooltip">{prompt}</span>}
        </span>;
      })}
      {visibleReferences.length > 3 && <button className="fc-generation-reference-chips__more" type="button" aria-label={`查看全部 ${visibleReferences.length} 个参考素材`} onClick={event => { positionFloatingPanel(event.currentTarget); setReferencePicker(null); setReferenceOverflowOpen(value => !value); }}>+{visibleReferences.length - 3}</button>}
    </div>
  </div>;

  return <><div ref={nodePanel} className={nodeClass} data-generation-mode={mode}>
    <header className="fc-generation-node__heading fc-node__header fc-node__drag-zone">
      <span className="fc-generation-node__badge" style={{ color: definition.color }}><Plus size={11} /></span>
      <strong>{node.data.title}</strong>
      <span className={`fc-node__status fc-node__status--${status}`}><i />{statusLabels[status] ?? '待生成'}</span>
    </header>

    <div className="fc-generation-node__preview fc-node__drag-zone">
      {previewSource
        ? <MediaPreview source={previewSource} kind={previewMediaKind} alt={`${String(node.data.title)}预览`} />
        : <button className="nodrag" type="button" disabled={readOnly || !descriptor.accept} onClick={() => requestUpload()} aria-label="添加节点素材"><FileUp size={26} /></button>}
      {nodeRunning && <div className="fc-generation-node__waiting" aria-hidden="true"><LoaderCircle size={34} /><span>{status === 'queued' ? '等待中' : '生成中'}</span></div>}
      {status === 'error' && <div className="fc-generation-node__error" role="alert"><strong>生成失败</strong><span>{String(node.data.runError || node.data.runMessage || '模型平台未返回失败详情')}</span></div>}
      {nodeRunning && <div className="fc-generation-node__running" role="status">
        <span>{String(node.data.runMessage || (status === 'queued' ? '排队中' : '生成中'))}</span>
        <strong>{Math.round(Number(node.data.progress ?? 0) * 100)}%</strong>
      </div>}
      {nodeRunning && <div className="fc-generation-node__progress"><span style={{ width: `${Math.round(Number(node.data.progress ?? 0) * 100)}%` }} /></div>}
    </div>

    <section className="fc-generation-composer nodrag nowheel" aria-label={`${descriptor.label}输入面板`}>
      <div className="fc-generation-tabs" role="tablist" aria-label="生成类型">
        {GENERATION_MODES.map(item => {
          const itemDescriptor = getGenerationModeDescriptor(item);
          return <button
            type="button"
            role="tab"
            aria-label={itemDescriptor.label}
            aria-selected={mode === item}
            className={mode === item ? 'is-active' : ''}
            disabled={readOnly}
            onClick={() => onChangeMode(item)}
            key={item}
          >{itemDescriptor.label}</button>;
        })}
        <button className="fc-generation-expand" type="button" aria-label={expanded ? '收起输入面板' : '展开输入面板'} onClick={() => setExpanded(value => !value)}>
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>

      <div className="fc-generation-input" data-mode={mode}>
        {(mode === 'text' || mode === 'image') && <div className="fc-generation-material-row"><div className="fc-generation-attachments">
          <button type="button" disabled={readOnly} onClick={() => requestUpload()}><Upload size={15} /><span>上传</span></button>
          <button type="button" title="从画布已生成素材中选择" disabled={readOnly} onClick={event => toggleReferencePicker('asset', event.currentTarget)}><MousePointer2 size={15} /><span>选择素材</span></button>
        </div>{referenceChips}</div>}

        {mode === 'video' && <div className="fc-generation-material-row"><div className="fc-generation-frames">
          <div className="fc-generation-frame-slot">
            <button className={effectiveFirstFrame ? 'is-selected' : ''} type="button" title={effectiveFirstFrame ? '在画布中央预览首帧' : '从画布素材中选择首帧'} disabled={readOnly} onClick={event => effectiveFirstFrame ? setPreviewReference(effectiveFirstFrame) : toggleReferencePicker('asset', event.currentTarget, 'firstFrame')}>{effectiveFirstFrame ? <ImageIcon size={16} /> : <Plus size={16} />}<span>首帧</span></button>
            {effectiveFirstFrame && <button className="fc-generation-remove-media" type="button" aria-label="移除首帧素材" disabled={readOnly} onClick={() => clearVideoFrame('firstFrame')}><X size={10} /></button>}
          </div>
          <ArrowRight size={16} />
          <div className="fc-generation-frame-slot">
            <button className={effectiveLastFrame ? 'is-selected' : ''} type="button" title={effectiveLastFrame ? '在画布中央预览尾帧' : '从画布素材中选择尾帧'} disabled={readOnly} onClick={event => effectiveLastFrame ? setPreviewReference(effectiveLastFrame) : toggleReferencePicker('asset', event.currentTarget, 'lastFrame')}>{effectiveLastFrame ? <ImageIcon size={16} /> : <Plus size={16} />}<span>尾帧</span></button>
            {effectiveLastFrame && <button className="fc-generation-remove-media" type="button" aria-label="移除尾帧素材" disabled={readOnly} onClick={() => clearVideoFrame('lastFrame')}><X size={10} /></button>}
          </div>
          <div className="fc-generation-frame-slot">
            <button type="button" title="选择画布素材或上传图片、视频和音频" disabled={readOnly} onClick={event => toggleReferencePicker('asset', event.currentTarget, 'reference')}><MousePointer2 size={15} /><span>选择素材</span></button>
          </div>
        </div>{referenceChips}</div>}

        <textarea
          ref={promptInput}
          className="nodrag nowheel"
          data-flowcanvas-ignore-shortcuts
          aria-label={`${descriptor.label}描述`}
          readOnly={readOnly}
          value={promptDraft}
          placeholder={descriptor.placeholder}
          onPointerDown={event => event.stopPropagation()}
          onFocus={beginPromptDraft}
          onCompositionStart={() => {
            beginPromptDraft();
            promptComposing.current = true;
          }}
          onCompositionEnd={finishPromptComposition}
          onChange={event => updatePromptDraft(event.target.value)}
          onBlur={commitPromptDraft}
        />

        <footer className="fc-generation-parameters">
          <div className="fc-generation-parameters__left">
            <ModelSelect label={`${descriptor.label}模型`} value={draft.model} options={modelOptions[mode]} disabled={readOnly} onChange={parameterModel} />

            {mode === 'image' && <>
              <ParameterSelect size="compact" label="图片比例" value={drafts.image.ratio} options={['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']} disabled={readOnly} onChange={value => updateDraft({ ratio: value })} />
              <ParameterSelect size="wide" label="图片画质" value={drafts.image.quality} options={['标准画质 · 1K', '标准画质 · 2K', '高清画质 · 4K']} disabled={readOnly} onChange={value => updateDraft({ quality: value })} />
              <button className="fc-generation-reference-button" type="button" title="在提示词中插入 @ 节点引用" aria-label="插入节点引用" disabled={readOnly} onClick={event => toggleReferencePicker('mention', event.currentTarget)}><AtSign size={15} /></button>
              <ParameterSelect size="compact" label="图片数量" value="1张" options={['1张']} disabled={true} onChange={() => {}} />
            </>}

            {mode === 'video' && <>
              <ParameterSelect size="compact" label="视频比例" value={drafts.video.ratio} options={isPro431 ? ['16:9', '9:16', '1:1'] : ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']} disabled={readOnly} onChange={value => updateDraft({ ratio: value })} />
              <ParameterSelect size="medium" label="视频分辨率" value={isPro431 ? '720p' : drafts.video.resolution} options={isPro431 ? ['720p'] : ['480p', '720p']} disabled={readOnly || isPro431} onChange={value => updateDraft({ resolution: value })} />
              <ParameterSelect size="compact" label="视频时长" value={`${drafts.video.duration}秒`} options={Array.from({ length: 12 }, (_, index) => `${index + 4}秒`)} disabled={readOnly} onChange={value => updateDraft({ duration: Number.parseInt(value, 10) })} />
              {!isPro431 && <ParameterSelect size="compact" label="生成声音" value={drafts.video.enableSound} options={['off', 'on']} disabled={readOnly} onChange={value => updateDraft({ enableSound: value })} />}
              <button className="fc-generation-reference-button" type="button" title="在提示词中插入 @ 节点引用" aria-label="插入节点引用" disabled={readOnly} onClick={event => toggleReferencePicker('mention', event.currentTarget)}><AtSign size={15} /></button>
            </>}

            {mode === 'audio' && <>
              <ParameterSelect size="wide" label="歌词生成方式" value={drafts.audio.lyricsMode} options={['自动生成', '纯音乐', '自定义歌词']} disabled={readOnly} onChange={value => updateDraft({ lyricsMode: value })} />
            </>}
          </div>

          <div className="fc-generation-submit-group">
            <span className="fc-generation-credit" title="预计消耗"><Sparkles size={13} />{generationCreditCost(mode, drafts)}</span>
            <button
              className="fc-generation-submit"
              type="button"
              aria-label={nodeRunning ? '取消当前节点' : status === 'success' ? '重新生成当前节点' : '生成当前节点'}
              title={nodeRunning ? '取消生成' : status === 'success' ? '重新生成（不会复用缓存）' : '开始生成'}
              disabled={readOnly || (!nodeRunning && !promptReady)}
              onClick={nodeRunning ? onCancel : () => {
                const kindCount = (kind: GenerationMediaKind) => visibleReferences.filter(reference => referenceKind(reference) === kind).length;
                if (mode === 'image' && kindCount('image') > IMAGE_REFERENCE_LIMIT) {
                  onNotify(`当前模型最多支持 ${IMAGE_REFERENCE_LIMIT} 张参考图片，请先移除多余素材`);
                  return;
                }
                if (isPro431) {
                  const limits: Array<[GenerationMediaKind, number, string]> = [['image', 4, '参考图片'], ['video', 3, '参考视频'], ['audio', 1, '参考音频']];
                  const exceeded = limits.find(([kind, limit]) => kindCount(kind) > limit);
                  if (exceeded) {
                    onNotify(`Seedance 2.0 Pro 最多支持 ${exceeded[1]} 个${exceeded[2]}，请先移除多余素材`);
                    return;
                  }
                  if ((effectiveFirstFrame || effectiveLastFrame) && visibleReferences.length) {
                    onNotify('Seedance 2.0 Pro 的首尾帧模式不能同时使用参考图片、视频或音频');
                    return;
                  }
                }
                onRun();
              }}
            ><ArrowUp size={17} /></button>
          </div>
        </footer>
      </div>
    </section>

    <input
      ref={uploadInput}
      className="fc-generation-file-input nodrag"
      type="file"
      tabIndex={-1}
      hidden
      multiple={pendingUploadSlot.current === 'reference'}
      accept={descriptor.accept}
      onChange={uploaded}
    />
  </div>{referencePanel}{overflowPanel}{mediaPreviewPanel}</>;
}
