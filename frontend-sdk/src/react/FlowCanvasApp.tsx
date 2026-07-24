import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import {
  AudioLines,
  Bot,
  Boxes,
  CheckCircle2,
  CirclePlay,
  Clapperboard,
  Download,
  FilePlus2,
  FileText,
  Hand,
  Image as ImageIcon,
  Maximize,
  Minus,
  Moon,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Pause,
  Plus,
  Redo2,
  RotateCcw,
  SquarePlus,
  Sun,
  Trash2,
  Unlink2,
  Undo2,
  Upload,
} from 'lucide-react';
import type { CanvasEngine, MutationOptions } from '../core/engine';
import type { CanvasNodeData, GraphDocument, NodeDefinition, Point } from '../core/types';
import type { FlowCanvasServices, SaveState } from '../services';
import {
  generationDataPatch,
  IMAGE_REFERENCE_LIMIT,
  generationModeFromNodeType,
  generationNodeTypeForMode,
  getGenerationModeDescriptor,
  isGenerationMode,
  isGenerationNodeType,
  normalizeGenerationDrafts,
  type GenerationMediaKind,
  type GenerationMediaReference,
  type GenerationMode,
} from '../generation';
import { GraphValidationError } from '../core/validation';
import { isRuntimeConfigurationRequiredError } from '../runtime/errors';
import { FlowNode, type FlowNodeModel } from './FlowNode';
import type { GenerationReference } from './GenerationNodePanel';
import type { FlowCanvasNodeRenderer, FlowCanvasRenderers } from './extensions';
import { Inspector, type InspectorTab } from './Inspector';
import { collectSelectedAssets, saveSelectedAssets } from './asset-export';

const nodeTypes = { flowcanvas: FlowNode };
const compatiblePortTypes = (source: string, target: string) => source === 'any' || target === 'any' || source === target;

const ownValue = <T,>(record: Record<string, T> | undefined, key: string): T | undefined => (
  record && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
);

export interface FlowCanvasAppProps {
  /** One engine per independent canvas; sharing an engine intentionally mirrors graph state. */
  engine: CanvasEngine;
  theme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  readOnly?: boolean;
  renderers?: FlowCanvasRenderers;
  services?: FlowCanvasServices;
  saveState?: SaveState;
}

const unknownNodeDefinition = (type: string): NodeDefinition => ({
  type,
  title: `未知节点 · ${type}`,
  category: '未注册',
  description: `节点类型“${type}”尚未注册，数据已保留。`,
  color: '#e98289',
  icon: 'text',
  inputs: [],
  outputs: [],
  createData: () => ({ title: `未知节点 · ${type}` }),
});

const saveStateLabels: Record<string, string> = {
  idle: '尚未保存',
  saving: '正在保存',
  saved: '已保存',
  error: '保存失败',
};
const saveStateText = (state: SaveState) => state.message ?? ownValue(saveStateLabels, state.status) ?? '保存状态未知';
const AUTO_INPUT_HANDLE = '__auto_input__';
const AUTO_OUTPUT_HANDLE = '__auto_output__';

const embeddableMediaKinds = new Set(['image', 'video', 'audio']);
const mediaKindFromDraft = (draft: { data?: Partial<CanvasNodeData> }): GenerationMediaKind => {
  const explicit = draft.data?.previewKind ?? draft.data?.mediaType ?? draft.data?.assetKind;
  if (explicit === 'image' || explicit === 'video' || explicit === 'audio' || explicit === 'text' || explicit === 'file') return explicit;
  const mimeType = typeof draft.data?.mimeType === 'string' ? draft.data.mimeType : '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/')) return 'text';
  return 'file';
};
const draftPreview = (draft: { data?: Partial<CanvasNodeData> }) => (
  typeof draft.data?.preview === 'string' ? draft.data.preview : ''
);
const mediaReferenceFromDraft = (draft: { data?: Partial<CanvasNodeData> }, index: number): GenerationMediaReference => {
  const fileName = String(draft.data?.fileName ?? draft.data?.title ?? `素材 ${index + 1}`);
  const mimeType = typeof draft.data?.mimeType === 'string' && draft.data.mimeType ? draft.data.mimeType : undefined;
  const url = draftPreview(draft) || undefined;
  const size = typeof draft.data?.size === 'number' ? draft.data.size : undefined;
  const lastModified = typeof draft.data?.lastModified === 'number' ? draft.data.lastModified : undefined;
  return {
    id: String(draft.data?.id ?? `${fileName}-${draft.data?.size ?? 0}-${draft.data?.lastModified ?? index}`),
    name: fileName,
    kind: mediaKindFromDraft(draft),
    ...(mimeType ? { mimeType } : {}),
    ...(url ? { url } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(lastModified !== undefined ? { lastModified } : {}),
  };
};
const embeddedMediaList = (value: unknown): GenerationMediaReference[] => (
  Array.isArray(value)
    ? value.filter((item): item is GenerationMediaReference => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
);
const supportsEmbeddedMedia = (node: GraphDocument['nodes'][number] | undefined): boolean => (
  Boolean(node && (node.type === 'blank' || node.type === 'local_asset' || isGenerationNodeType(node.type) || isGenerationMode(node.data.generationMode)))
);
const acceptsDroppedMedia = (
  node: GraphDocument['nodes'][number] | undefined,
  kind: GenerationMediaKind,
): boolean => {
  if (!node || !embeddableMediaKinds.has(kind)) return false;
  if (node.type === 'blank' || node.type === 'local_asset') return true;
  const mode = isGenerationMode(node.data.generationMode)
    ? node.data.generationMode
    : generationModeFromNodeType(node.type);
  if (mode === 'image') return kind === 'image';
  if (mode === 'video') return kind === 'image' || kind === 'video' || kind === 'audio';
  if (mode === 'audio') return kind === 'audio';
  return false;
};
const referenceKey = (reference: GenerationMediaReference) => reference.id || reference.name;
const appendReference = (
  existing: readonly (string | GenerationMediaReference)[],
  reference: GenerationMediaReference,
  limit = 24,
): (string | GenerationMediaReference)[] => {
  const next = existing.filter(item => (typeof item === 'string' ? item : referenceKey(item)) !== referenceKey(reference));
  return [...next, reference].slice(-limit);
};
const dropTargetNodeId = (target: EventTarget | null, clientX?: number, clientY?: number): string | undefined => {
  const element = target instanceof Element ? target : undefined;
  const direct = element?.closest('.react-flow__node')?.getAttribute('data-id');
  if (direct) return direct;
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    return document.elementFromPoint(Number(clientX), Number(clientY))
      ?.closest('.react-flow__node')?.getAttribute('data-id') ?? undefined;
  }
  return undefined;
};
const mediaKindFromNode = (node: GraphDocument['nodes'][number]): string => (
  String(
    (node.data.generationMode === 'image' || node.type === 'image' ? 'image' : undefined)
    ?? (node.data.generationMode === 'video' || node.type === 'video' ? 'video' : undefined)
    ?? (node.data.generationMode === 'audio' || node.type === 'audio' ? 'audio' : undefined)
    ?? node.data.previewKind
    ?? node.data.mediaType
    ?? node.data.assetKind
    ?? '',
  )
);
const nodePreview = (node: GraphDocument['nodes'][number]): string => {
  const expectedKind = mediaKindFromNode(node);
  const declaredPreviewKind = String(node.data.previewKind ?? '').toLowerCase();
  const previewMatchesNode = !declaredPreviewKind || !expectedKind || declaredPreviewKind === expectedKind;
  const candidates = [
    ...(previewMatchesNode ? [node.data.preview] : []),
    node.data.resultUrl,
    node.data.result_url,
    node.data.videoUrl,
    node.data.remoteUrl,
    node.data.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const embedded = embeddedMediaList(node.data.embeddedMedia);
  const latest = [...embedded].reverse().find(item => {
    const hasSource = typeof item.url === 'string' || typeof (item as unknown as Record<string, unknown>).preview === 'string';
    return hasSource && (!expectedKind || !item.kind || item.kind === expectedKind);
  });
  if (!latest) return '';
  return String(latest.url ?? (latest as unknown as Record<string, unknown>).preview ?? '').trim();
};
const normalizedReferenceStatus = (node: GraphDocument['nodes'][number], preview: string): string => {
  const status = String(node.data.status ?? 'idle').toLowerCase();
  if (['success', 'succeeded', 'completed', 'complete'].includes(status)) return 'success';
  if (['error', 'failed', 'failure'].includes(status)) return 'error';
  if (['queued', 'pending'].includes(status)) return 'queued';
  if (['running', 'in_progress', 'processing'].includes(status)) return 'running';
  // A persisted preview is the material catalogue's source of truth. Older
  // documents and interrupted app shutdowns can retain a valid generated file
  // while their status is still `idle`; hiding that file made the material
  // picker look empty after restart.
  if (preview && embeddableMediaKinds.has(mediaKindFromNode(node))) return 'success';
  return status;
};
const generationPrompt = (node: GraphDocument['nodes'][number]): string => {
  const mode = isGenerationMode(node.data.generationMode)
    ? node.data.generationMode
    : generationModeFromNodeType(node.type);
  if (!mode) return '';
  const drafts = normalizeGenerationDrafts(node.data.generationDrafts, node.data, mode);
  return String(drafts[mode].prompt ?? node.data.prompt ?? '');
};
const defaultNodeDimensions = (node: GraphDocument['nodes'][number], definition: NodeDefinition): { width: number; height: number } => {
  if (isGenerationNodeType(definition.type) || isGenerationMode(node.data.generationMode)) {
    const prompt = generationPrompt(node);
    const visualRows = prompt.split(/\r?\n/).reduce((rows, line) => {
      const weightedLength = [...line].reduce((width, character) => width + (/^[\x00-\xff]$/.test(character) ? .55 : 1), 0);
      return rows + Math.max(1, Math.ceil(weightedLength / 48));
    }, 0);
    const extraHeight = Math.max(0, visualRows - 3) * 23;
    // Keep the fixed action row fully inside the rounded input panel. The
    // additional six pixels are the visual safe area below the 32px submit
    // button; without them the button touches the inner border at common
    // Windows display scales even though its rectangle is technically inside.
    return { width: 720, height: 664 + extraHeight };
  }
  if (definition.type === 'blank') return { width: 420, height: 290 };
  const kind = mediaKindFromNode(node);
  if (kind === 'audio') return { width: 320, height: 180 };
  if (kind === 'image' || kind === 'video') return { width: 420, height: 290 };
  return { width: 232, height: 150 };
};

function CanvasWorkspace({ engine, theme, onThemeChange, readOnly = false, renderers, services, saveState }: FlowCanvasAppProps) {
  const engineVersion = useSyncExternalStore(engine.subscribe, engine.getVersion, engine.getVersion);
  // The engine owns this zero-copy snapshot. UI code treats it as immutable.
  const graph = engine.getGraphSnapshot() as GraphDocument;
  const selection = engine.getSelection();
  const validation = engine.getValidationSnapshot();
  const reactFlow = useReactFlow();
  const viewport = useViewport();
  const reactFlowId = useId().replace(/:/g, '');
  const dragSnapshot = useRef<GraphDocument | undefined>(undefined);
  const nodeModelCache = useRef(new Map<string, {
    data: unknown;
    position: unknown;
    definition: NodeDefinition;
    renderer: FlowCanvasNodeRenderer | undefined;
    readOnly: boolean;
    running: boolean;
    selected: boolean;
    width: number | undefined;
    height: number | undefined;
    edgeSignature: string;
    model: FlowNodeModel;
  }>());
  const edgeModelCache = useRef(new Map<string, { edge: unknown; selected: boolean; model: Edge }>());
  const canvasElement = useRef<HTMLElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const assetInput = useRef<HTMLInputElement>(null);
  const assetController = useRef<AbortController | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => engine.getSelection().nodeIds.length > 0);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('properties');
  const [interactionMode, setInteractionMode] = useState<'select' | 'pan'>('select');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [toast, setToast] = useState('');
  const [contextMenu, setContextMenu] = useState<{ kind: 'node' | 'edge'; id: string; x: number; y: number } | null>(null);
  const activeRunIds = useRef(new Set<string>());
  const [running, setRunning] = useState(engine.isRunning());
  const [importingAssets, setImportingAssets] = useState(false);
  const pendingDraftCommit = useRef<(() => void) | undefined>(undefined);
  const [hasPendingDraft, setHasPendingDraft] = useState(false);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest('.fc-context-menu')) setContextMenu(null);
    };
    window.addEventListener('pointerdown', dismiss, true);
    return () => window.removeEventListener('pointerdown', dismiss, true);
  }, [contextMenu]);
  const handleDraftChange = useCallback((active: boolean, commit?: () => void) => {
    pendingDraftCommit.current = active ? commit : undefined;
    setHasPendingDraft(active);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // React Flow may deliver a final onMoveEnd after its viewport animation
      // has been torn down. Do not let that late callback revive a destroyed
      // engine during Electron/window disposal.
      mounted.current = false;
      assetController.current?.abort();
      window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    const disposeStart = engine.on('run:start', ({ runId }) => {
      activeRunIds.current.add(runId);
      setRunning(true);
    });
    const disposeEnd = engine.on('run:end', ({ runId }) => {
      activeRunIds.current.delete(runId);
      setRunning(activeRunIds.current.size > 0);
    });
    setRunning(engine.isRunning());
    return () => { disposeStart(); disposeEnd(); };
  }, [engine]);

  useEffect(() => {
    void reactFlow.setViewport({
      x: graph.viewport.x,
      y: graph.viewport.y,
      zoom: graph.viewport.zoom,
    });
  }, [graph.id, graph.viewport.x, graph.viewport.y, graph.viewport.zoom, reactFlow]);

  useEffect(() => {
    if (readOnly) setLibraryOpen(false);
  }, [readOnly]);

  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(''), 2200);
  }, []);

  const updateGenerationData = useCallback((nodeId: string, patch: Partial<CanvasNodeData>, options?: MutationOptions) => {
    engine.updateNodeData(nodeId, patch, options);
  }, [engine]);

  const changeGenerationMode = useCallback((nodeId: string, mode: GenerationMode) => {
    const graphDocument = engine.getGraph();
    const node = graphDocument.nodes.find(item => item.id === nodeId);
    if (!node) return;
  const targetType = generationNodeTypeForMode(mode);
    if (!engine.registry.has(targetType)) {
      notify(`未注册“${mode}”对应的节点类型：${targetType}`);
      return;
    }
    const currentMode = isGenerationMode(node.data.generationMode)
      ? node.data.generationMode
      : generationModeFromNodeType(node.type) ?? 'text';
    const drafts = normalizeGenerationDrafts(node.data.generationDrafts, node.data, currentMode);
    const definition = engine.registry.get(targetType);
    const descriptor = getGenerationModeDescriptor(mode);
    engine.updateNode(nodeId, {
      type: targetType,
      data: {
        ...generationDataPatch(mode, drafts),
        title: definition?.title ?? descriptor.label,
        description: definition?.description ?? descriptor.placeholder,
        status: 'idle',
        progress: 0,
        runMessage: '',
        runError: '',
      },
    });
  }, [engine, notify]);

  const getGenerationReferences = useCallback((nodeId: string) => engine.getGraph().nodes
    .filter(node => node.id !== nodeId)
    .flatMap(node => {
      const preview = nodePreview(node);
      const kind = mediaKindFromNode(node) as GenerationMediaKind;
      const directPreview = typeof node.data.preview === 'string' && node.data.preview.trim();
      const previewingEmbedded = !directPreview
        ? [...embeddedMediaList(node.data.embeddedMedia)].reverse().find(reference => reference.url === preview)
        : undefined;
      const importedFileTitle = node.data.previewOrigin === 'input' && typeof node.data.fileName === 'string'
        ? node.data.fileName
        : '';
      const nodeReference: GenerationReference = {
        id: node.id,
        sourceNodeId: node.id,
        title: String(importedFileTitle || previewingEmbedded?.name || node.data.title || engine.registry.get(node.type)?.title || node.type),
        type: node.type,
        status: normalizedReferenceStatus(node, preview),
        prompt: typeof node.data.prompt === 'string' ? node.data.prompt : '',
        preview,
        kind,
        mimeType: typeof node.data.mimeType === 'string' ? node.data.mimeType : '',
      };
      const embeddedReferences = embeddedMediaList(node.data.embeddedMedia)
        .map((reference, index): GenerationReference | undefined => {
          const source = String(reference.url ?? '').trim();
          if (!source || !embeddableMediaKinds.has(reference.kind)) return undefined;
          if (source === preview && reference.kind === kind) return undefined;
          return {
            id: `asset:${node.id}:${reference.id || index}`,
            title: reference.name || `本地素材 ${index + 1}`,
            type: 'local_asset',
            status: 'success',
            prompt: typeof (reference as unknown as Record<string, unknown>).prompt === 'string'
              ? String((reference as unknown as Record<string, unknown>).prompt)
              : '',
            preview: source,
            kind: reference.kind,
            mimeType: reference.mimeType ?? '',
          };
        })
        .filter((reference): reference is GenerationReference => Boolean(reference));
      return [nodeReference, ...embeddedReferences];
    }), [engine]);

  const getConnectedReferences = useCallback((nodeId: string) => {
    const current = engine.getGraph();
    const acceptedPorts = new Set(['reference', 'image', 'lastFrame']);
    return current.edges
      .filter(edge => edge.target === nodeId && acceptedPorts.has(edge.targetPort))
      .map(edge => {
        const source = current.nodes.find(node => node.id === edge.source);
        if (!source) return undefined;
        return {
          id: edge.id,
          sourceNodeId: source.id,
          title: String(source.data.title || engine.registry.get(source.type)?.title || source.type),
          type: source.type,
          status: normalizedReferenceStatus(source, nodePreview(source)),
          prompt: typeof source.data.prompt === 'string' ? source.data.prompt : '',
          preview: nodePreview(source),
          kind: mediaKindFromNode(source) as GenerationMediaKind,
          mimeType: typeof source.data.mimeType === 'string' ? source.data.mimeType : '',
          targetPort: edge.targetPort,
          connected: true,
        };
      })
      .filter((reference): reference is NonNullable<typeof reference> => Boolean(reference));
  }, [engine]);

  const disconnectReference = useCallback((targetNodeId: string, sourceNodeId: string, targetPort?: string, edgeId?: string) => {
    const edgeIds = engine.getGraph().edges
      .filter(edge => edge.target === targetNodeId
        && edge.source === sourceNodeId
        && ['reference', 'image', 'lastFrame'].includes(edge.targetPort)
        && (!targetPort || edge.targetPort === targetPort)
        && (!edgeId || edge.id === edgeId))
      .map(edge => edge.id);
    if (edgeIds.length) {
      engine.removeEdges(edgeIds);
      notify(`已断开参考素材连线`);
    }
  }, [engine, notify]);

  const runGenerationNode = useCallback(async (nodeId: string) => {
    try {
      // An explicit click always means a fresh provider request. Cache remains
      // available to workflow runs, but must never make "regenerate" finish
      // instantly with an old output.
      const result = await engine.runNode(nodeId, { refreshNodeIds: [nodeId] });
      notify(result.status === 'success'
        ? '当前节点生成完成'
        : result.status === 'cancelled'
          ? '当前节点生成已取消'
          : `当前节点生成失败：${result.error}`);
    } catch (error) {
      if (isRuntimeConfigurationRequiredError(error)) {
        notify(`请先完成配置：${error.message}`);
        try {
          await services?.configuration?.onRequired(error);
        } catch (configurationError) {
          notify(`打开配置失败：${configurationError instanceof Error ? configurationError.message : String(configurationError)}`);
        }
      } else {
        notify(`当前节点生成失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, [engine, notify, services?.configuration]);

  const selectedNode = graph.nodes.find(node => selection.nodeIds.includes(node.id));
  const selectedDefinition = selectedNode
    ? engine.registry.get(selectedNode.type) ?? unknownNodeDefinition(selectedNode.type)
    : undefined;
  const flowNodes = useMemo<FlowNodeModel[]>(() => {
    const selectedIds = new Set(selection.nodeIds);
    const activeIds = new Set<string>();
    const result = graph.nodes.map(node => {
      activeIds.add(node.id);
      const selected = selectedIds.has(node.id);
      const definition = engine.registry.get(node.type) ?? unknownNodeDefinition(node.type);
      const renderer = ownValue(renderers?.nodes, node.type);
      const dimensions = defaultNodeDimensions(node, definition);
      const { width, height } = dimensions;
      const edgeSignature = graph.edges
        .filter(edge => edge.source === node.id || edge.target === node.id)
        .map(edge => `${edge.id}:${edge.sourcePort}:${edge.targetPort}`)
        .join('|');
      const cached = nodeModelCache.current.get(node.id);
      if (cached
        && cached.data === node.data
        && cached.position === node.position
        && cached.definition === definition
        && cached.renderer === renderer
        && cached.readOnly === readOnly
        && cached.running === running
        && cached.selected === selected
        && cached.width === node.width
        && cached.height === node.height
        && cached.edgeSignature === edgeSignature) return cached.model;
      const model: FlowNodeModel = {
        id: node.id,
        type: 'flowcanvas',
        position: { x: node.position.x, y: node.position.y },
        // React Flow clears its internal measurement whenever a new user-node
        // object omits `measured`. Prompt edits intentionally replace node.data
        // on every transient update, so preserving the fixed dimensions here
        // prevents the wrapper from briefly becoming visibility:hidden (which
        // makes browsers blur the active textarea).
        width,
        height,
        initialWidth: width,
        initialHeight: height,
        measured: { width, height },
        style: { width, height },
        data: {
          ...node.data,
          definition,
          node,
          renderer,
          onRendererError: error => engine.events.emit('error', { error, source: `renderer:node:${node.type}` }),
          readOnly,
          running,
          onUpdateData: (patch, options) => updateGenerationData(node.id, patch, options),
          onCaptureSnapshot: () => engine.captureSnapshot(),
          onCommitSnapshot: (label, before) => engine.commitSnapshot(label, before),
          onDraftChange: handleDraftChange,
          onChangeGenerationMode: mode => changeGenerationMode(node.id, mode),
          onRunNode: () => { void runGenerationNode(node.id); },
          onCancelRun: () => engine.cancelNode(node.id),
          onNotify: notify,
          getReferences: () => getGenerationReferences(node.id),
          connectedReferences: getConnectedReferences(node.id),
          onDisconnectReference: (sourceNodeId, targetPort, edgeId) => disconnectReference(node.id, sourceNodeId, targetPort, edgeId),
        },
        selected,
        draggable: !readOnly && !node.locked,
      };
      nodeModelCache.current.set(node.id, {
        data: node.data, position: node.position, definition, renderer, readOnly, running, selected, width: node.width, height: node.height, edgeSignature, model,
      });
      return model;
    });
    for (const id of nodeModelCache.current.keys()) if (!activeIds.has(id)) nodeModelCache.current.delete(id);
    return result;
  }, [engineVersion, graph.nodes, graph.edges, selection.nodeIds, engine.registry, readOnly, renderers?.nodes, running, updateGenerationData, changeGenerationMode, runGenerationNode, notify, getGenerationReferences, getConnectedReferences, disconnectReference, handleDraftChange, engine]);

  const flowEdges = useMemo(() => {
    const selectedIds = new Set(selection.edgeIds);
    const activeIds = new Set<string>();
    const result = graph.edges.map(edge => {
      activeIds.add(edge.id);
      const selected = selectedIds.has(edge.id);
      const cached = edgeModelCache.current.get(edge.id);
      if (cached && cached.edge === edge && cached.selected === selected) return cached.model;
      const model: Edge = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: AUTO_OUTPUT_HANDLE,
        targetHandle: AUTO_INPUT_HANDLE,
        selected,
        className: 'fc-edge',
      };
      edgeModelCache.current.set(edge.id, { edge, selected, model });
      return model;
    });
    for (const id of edgeModelCache.current.keys()) if (!activeIds.has(id)) edgeModelCache.current.delete(id);
    return result;
  }, [engineVersion, graph.edges, selection.edgeIds]);

  const onNodesChange = (changes: NodeChange<FlowNodeModel>[]) => {
    const removed = readOnly ? [] : changes.filter(change => change.type === 'remove').map(change => change.id);
    if (removed.length) engine.removeNodes(removed);

    const removedIds = new Set(removed);
    const selectedNodeIds = new Set(selection.nodeIds.filter(id => !removedIds.has(id)));
    let selectionChanged = removed.length > 0;

    for (const change of changes) {
      if (!readOnly && change.type === 'position' && change.position) {
        engine.updateNode(change.id, { position: change.position }, { record: false, transient: true });
      }
      if (change.type === 'select' && !removedIds.has(change.id)) {
        selectionChanged = true;
        if (change.selected) selectedNodeIds.add(change.id);
        else selectedNodeIds.delete(change.id);
      }
    }

    if (selectionChanged) {
      engine.setSelection({
        nodeIds: [...selectedNodeIds],
        edgeIds: removed.length ? [] : selection.edgeIds,
      });
    }
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = readOnly ? [] : changes.filter(change => change.type === 'remove').map(change => change.id);
    if (removed.length) engine.removeEdges(removed);

    const removedIds = new Set(removed);
    const selectedEdgeIds = new Set(selection.edgeIds.filter(id => !removedIds.has(id)));
    let selectionChanged = removed.length > 0;

    for (const change of changes) {
      if (change.type === 'select' && !removedIds.has(change.id)) {
        selectionChanged = true;
        if (change.selected) selectedEdgeIds.add(change.id);
        else selectedEdgeIds.delete(change.id);
      }
    }

    if (selectionChanged) {
      engine.setSelection({
        nodeIds: selection.nodeIds,
        edgeIds: [...selectedEdgeIds],
      });
    }
  };

  const normalizeConnection = (connection: Connection | Edge): Connection | undefined => {
    if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return undefined;
    const sourceNode = graph.nodes.find(node => node.id === connection.source);
    const targetNode = graph.nodes.find(node => node.id === connection.target);
    const sourceDefinition = sourceNode && engine.registry.get(sourceNode.type);
    const targetDefinition = targetNode && engine.registry.get(targetNode.type);
    const sourcePort = connection.sourceHandle === AUTO_OUTPUT_HANDLE
      ? sourceDefinition?.outputs[0]
      : sourceDefinition?.outputs.find(port => port.id === connection.sourceHandle);
    const requestedTargetPort = connection.targetHandle === AUTO_INPUT_HANDLE
      ? undefined
      : targetDefinition?.inputs.find(port => port.id === connection.targetHandle);
    const forward = Boolean(sourcePort && targetDefinition?.inputs.length && (connection.targetHandle === AUTO_INPUT_HANDLE || requestedTargetPort));
    if (forward) {
      const compatibleTargets = targetDefinition?.inputs.filter(port => compatiblePortTypes(sourcePort!.dataType, port.dataType)) ?? [];
      const preferredIds = sourcePort!.dataType === 'text'
        ? ['prompt', 'text', 'input']
        : targetNode?.type === 'image'
          ? ['reference', 'input']
          : targetNode?.type === 'video'
            ? ['reference', 'image', 'input']
            : ['input', 'reference'];
      const targetPort = requestedTargetPort && compatiblePortTypes(sourcePort!.dataType, requestedTargetPort.dataType)
        ? requestedTargetPort
        : preferredIds.map(id => compatibleTargets.find(port => port.id === id)).find(Boolean) ?? compatibleTargets[0];
      if (!targetPort) return undefined;
      return {
        source: connection.source,
        sourceHandle: sourcePort!.id,
        target: connection.target,
        targetHandle: targetPort.id,
      };
    }
    return undefined;
  };

  const connect = (connection: Connection) => {
    if (readOnly) return;
    const normalized = normalizeConnection(connection);
    if (!normalized?.source || !normalized.target || !normalized.sourceHandle || !normalized.targetHandle) return;
    try {
      engine.addEdge({
        source: normalized.source,
        sourcePort: normalized.sourceHandle,
        target: normalized.target,
        targetPort: normalized.targetHandle,
      });
    } catch (error) {
      notify(error instanceof GraphValidationError ? error.result.issues[0]?.message ?? error.message : String(error));
    }
  };

  const deleteSelection = () => {
    if (readOnly) return;
    const nodeIds = [...selection.nodeIds];
    const edgeIds = [...selection.edgeIds];
    if (!nodeIds.length && !edgeIds.length) {
      notify('请先选中要删除的节点或连线');
      return;
    }
    pendingDraftCommit.current?.();
    pendingDraftCommit.current = undefined;
    if (nodeIds.length) engine.removeNodes(nodeIds);
    if (edgeIds.length) engine.removeEdges(edgeIds);
    notify(`已删除 ${nodeIds.length} 个节点、${edgeIds.length} 条连线`);
  };

  const addAtCenter = (type: string) => {
    if (readOnly) return;
    const bounds = canvasElement.current?.getBoundingClientRect();
    const position = reactFlow.screenToFlowPosition({ x: (bounds?.left ?? 0) + (bounds?.width ?? 800) / 2, y: (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2 });
    engine.addNode(type, position);
    setLibraryOpen(false);
  };

  const getCanvasCenter = (): Point => {
    const bounds = canvasElement.current?.getBoundingClientRect();
    return reactFlow.screenToFlowPosition({
      x: (bounds?.left ?? 0) + (bounds?.width ?? 800) / 2,
      y: (bounds?.top ?? 0) + (bounds?.height ?? 600) / 2,
    });
  };

  const selectedMediaTarget = () => (
    selection.nodeIds.length === 1 ? selection.nodeIds[0] : undefined
  );

  const openAssetPicker = () => {
    if (readOnly || !services?.assets || importingAssets) return;
    assetInput.current?.click();
  };

  const selectedExportAssets = collectSelectedAssets(graph.nodes, selection.nodeIds);
  const exportSelectedAssets = async () => {
    if (!selection.nodeIds.length) {
      notify('请先选中需要保存的素材节点');
      return;
    }
    if (!selectedExportAssets.length) {
      notify('选中的节点没有可保存的图片、视频、音频或文本');
      return;
    }
    const skipped = selection.nodeIds.length - new Set(selectedExportAssets.map(asset => asset.nodeId)).size;
    try {
      const result = await saveSelectedAssets(selectedExportAssets, Math.max(0, skipped));
      if (result.cancelled) return;
      notify(result.skipped
        ? `已保存 ${result.saved} 个素材，跳过 ${result.skipped} 个不支持的节点`
        : `已保存 ${result.saved} 个选中素材`);
    } catch (error) {
      notify(`保存素材失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const run = async () => {
    if (!validation.valid) { notify(`存在 ${validation.issues.filter(issue => issue.severity === 'error').length} 项错误`); return; }
    try {
      const result = await engine.run({ useCache: true });
      notify(result.status === 'success' ? '工作流运行完成' : result.status === 'cancelled' ? '运行已取消' : `运行失败：${result.error}`);
    } catch (error) {
      if (isRuntimeConfigurationRequiredError(error)) {
        const message = error.message;
        notify(`请先完成配置：${message}`);
        try {
          await services?.configuration?.onRequired(error);
        } catch (configurationError) {
          notify(`打开配置失败：${configurationError instanceof Error ? configurationError.message : String(configurationError)}`);
        }
      } else {
        notify(`运行失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      // run:start/run:end are authoritative so host-triggered runs stay in sync.
    }
  };

  const download = () => {
    const blob = new Blob([engine.exportGraph()], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${graph.name}.flowcanvas.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const importFile = async (file?: File) => {
    if (!file || readOnly) return;
    try {
      engine.importGraph(await file.text());
      notify('工作流已导入');
    } catch (error) {
      notify(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const importAssets = async (files: readonly File[], position: Point, source: 'picker' | 'drop', targetNodeId?: string) => {
    const assetService = services?.assets;
    if (!assetService || readOnly || !files.length || importingAssets) return;

    const controller = new AbortController();
    assetController.current?.abort();
    assetController.current = controller;
    setImportingAssets(true);
    try {
      const drafts = await assetService.pickFiles({
        source,
        files,
        accept: assetService.accept,
        graph: engine.getGraph(),
        position,
        targetNodeId,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      let added = 0;
      let embedded = 0;
      const unknownTypes = new Set<string>();
      const rejectedFiles: string[] = [];
      engine.transaction('导入素材', current => {
        drafts.forEach((draft, index) => {
          const reference = mediaReferenceFromDraft(draft, index);
          const mediaKind = reference.kind;
          const embeddable = embeddableMediaKinds.has(mediaKind) && Boolean(reference.url);
          const target = targetNodeId
            ? current.getGraphSnapshot().nodes.find(node => node.id === targetNodeId)
            : undefined;

          if (embeddable && supportsEmbeddedMedia(target)) {
            if (!acceptsDroppedMedia(target, mediaKind)) {
              rejectedFiles.push(reference.name);
              return;
            }

            const convertingBlank = target!.type === 'blank' && current.registry.has(mediaKind);
            const targetType = convertingBlank ? mediaKind : target!.type;
            const targetDefinition = current.registry.require(targetType);
            const targetDefaults = convertingBlank ? targetDefinition.createData() : target!.data;
            const nextEmbedded = [...embeddedMediaList(convertingBlank ? undefined : target!.data.embeddedMedia), reference].slice(-24);
            const patch: Partial<CanvasNodeData> = {
              ...(convertingBlank ? targetDefaults : {}),
              title: convertingBlank ? targetDefinition.title : target!.data.title,
              embeddedMedia: nextEmbedded,
              ...((convertingBlank || target!.type === 'local_asset') ? {
                preview: reference.url,
                previewKind: mediaKind,
                mediaType: mediaKind,
                previewOrigin: 'input',
              } : {}),
              mimeType: reference.mimeType ?? '',
              fileName: reference.name,
              status: 'idle',
              progress: 0,
              runMessage: '',
              runError: '',
            };
            const mode = isGenerationMode(targetDefaults.generationMode)
              ? targetDefaults.generationMode
              : generationModeFromNodeType(targetType);
            if (mode) {
              const draftsForNode = normalizeGenerationDrafts(targetDefaults.generationDrafts, targetDefaults, mode);
              draftsForNode[mode].references = appendReference(
                draftsForNode[mode].references,
                reference,
                mode === 'image' ? IMAGE_REFERENCE_LIMIT : 24,
              );
              Object.assign(patch, generationDataPatch(mode, draftsForNode));
            }
            current.updateNode(target!.id, { ...(convertingBlank ? { type: targetType } : {}), data: patch });
            embedded += 1;
            return;
          }

          if (embeddable && current.registry.has('blank')) {
            const fallbackPosition = { x: position.x + index * 390, y: position.y + (index % 2) * 28 };
            current.addNode('blank', draft.position ?? fallbackPosition, {
              title: '空白节点',
              description: '已嵌入本地素材',
              embeddedMedia: [reference],
              preview: reference.url,
              previewKind: mediaKind,
              mediaType: mediaKind,
              mimeType: reference.mimeType ?? '',
              fileName: reference.name,
            });
            added += 1;
            return;
          }

          if (!current.registry.has(draft.type)) {
            unknownTypes.add(draft.type);
            return;
          }
          const previewKind = String(draft.data?.previewKind ?? draft.data?.mediaType ?? '');
          const isWideMedia = draft.type === 'local_asset' && (previewKind === 'image' || previewKind === 'video');
          const fallbackPosition = isWideMedia
            ? { x: position.x + index * 390, y: position.y + (index % 2) * 28 }
            : { x: position.x + index * 28, y: position.y + index * 28 };
          current.addNode(
            draft.type,
            draft.position ?? fallbackPosition,
            draft.data,
          );
          added += 1;
        });
      });
      if (unknownTypes.size) notify(`未注册资产节点：${[...unknownTypes].join('、')}`);
      else if (rejectedFiles.length) notify(`部分素材与目标节点不兼容：${rejectedFiles.join('、')}`);
      else if (embedded) notify(`已嵌入 ${embedded} 个素材到节点`);
      else notify(added ? `已添加 ${added} 个素材节点` : '未生成可添加的素材节点');
    } catch (error) {
      if (!controller.signal.aborted) notify(`素材导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (assetController.current === controller) {
        assetController.current = undefined;
        setImportingAssets(false);
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const editing = target.isContentEditable || Boolean(target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], [data-flowcanvas-ignore-shortcuts]',
    ));
    if (editing) return;
    const command = event.ctrlKey || event.metaKey;
    if (!readOnly && command && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? engine.redo() : engine.undo(); }
    if (!readOnly && command && event.key.toLowerCase() === 'y') { event.preventDefault(); engine.redo(); }
    if (command && event.key.toLowerCase() === 'c') { event.preventDefault(); engine.copySelection(); notify('已复制选中节点'); }
    if (!readOnly && command && event.key.toLowerCase() === 'v') { event.preventDefault(); engine.pasteClipboard(); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) {
      if (selection.nodeIds.length) engine.removeNodes(selection.nodeIds);
      if (selection.edgeIds.length) engine.removeEdges(selection.edgeIds);
    }
  };

  return (
    <div
      className="fc-sdk"
      data-theme={theme}
      data-interaction-mode={interactionMode}
      data-read-only={readOnly ? 'true' : 'false'}
      data-save-state={saveState?.status}
      data-testid="flowcanvas-sdk"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <main className={`fc-workspace${inspectorOpen ? '' : ' is-inspector-closed'}`}>
        <section
          ref={canvasElement}
          className="fc-canvas"
          onDragOverCapture={event => {
            if (!readOnly && (event.dataTransfer.types.includes('application/flowcanvas-node') || (services?.assets && event.dataTransfer.types.includes('Files')))) event.preventDefault();
          }}
          onDropCapture={event => {
            event.preventDefault();
            event.stopPropagation();
            if (readOnly) return;
            const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            const type = event.dataTransfer.getData('application/flowcanvas-node');
            if (type) {
              if (engine.registry.has(type)) engine.addNode(type, position);
              else notify(`节点类型“${type}”尚未注册`);
              return;
            }
            if (services?.assets && event.dataTransfer.files.length) {
              void importAssets(
                Array.from(event.dataTransfer.files),
                position,
                'drop',
                dropTargetNodeId(event.target, event.clientX, event.clientY),
              );
            }
          }}
        >
          <ReactFlow<FlowNodeModel>
            id={`flowcanvas-${reactFlowId}`}
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            connectionMode={ConnectionMode.Strict}
            connectOnClick
            connectionDragThreshold={0}
            onNodeDragStart={() => { if (!readOnly && interactionMode === 'select') dragSnapshot.current = engine.captureSnapshot(); }}
            onNodeDragStop={() => { if (!readOnly && dragSnapshot.current) engine.commitSnapshot('移动节点', dragSnapshot.current); dragSnapshot.current = undefined; }}
            onMoveEnd={(_, viewport) => {
              if (mounted.current && !readOnly) engine.setViewport(viewport);
            }}
            defaultViewport={{ x: graph.viewport.x, y: graph.viewport.y, zoom: graph.viewport.zoom }}
            selectionMode={SelectionMode.Partial}
            selectionOnDrag={interactionMode === 'select'}
            panOnDrag={interactionMode === 'pan'}
            panOnScroll
            zoomOnScroll
            multiSelectionKeyCode={['Control', 'Meta', 'Shift']}
            deleteKeyCode={null}
            nodesConnectable={!readOnly}
            nodesDraggable={!readOnly && interactionMode === 'select'}
            onNodeContextMenu={(event, node) => {
              if (readOnly) return;
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ kind: 'node', id: node.id, x: event.clientX, y: event.clientY });
            }}
            onEdgeContextMenu={(event, edge) => {
              if (readOnly) return;
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ kind: 'edge', id: edge.id, x: event.clientX, y: event.clientY });
            }}
            onEdgeDoubleClick={(event, edge) => {
              if (readOnly) return;
              event.preventDefault();
              event.stopPropagation();
              engine.removeEdges([edge.id]);
              notify('已取消连线');
            }}
            onPaneClick={() => setContextMenu(null)}
            elementsSelectable={interactionMode === 'select'}
            connectionRadius={26}
            onlyRenderVisibleElements
            minZoom={.2}
            maxZoom={1.8}
          >
            <Background variant={BackgroundVariant.Lines} gap={32} size={1} />
            <MiniMap className="fc-minimap" pannable zoomable nodeColor={node => String((node.data as FlowNodeModel['data']).definition.color ?? '#8e96a1')} />
          </ReactFlow>

          {contextMenu && <div
            className="fc-context-menu nodrag nowheel"
            role="menu"
            aria-label={contextMenu.kind === 'edge' ? '连线操作' : '节点操作'}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.kind === 'edge' ? <button type="button" role="menuitem" onClick={() => {
              engine.removeEdges([contextMenu.id]);
              setContextMenu(null);
              notify('已取消连线');
            }}><Unlink2 size={14} />取消连线</button> : <>
              <button type="button" role="menuitem" disabled={!engine.isNodeRunning(contextMenu.id)} onClick={() => {
                engine.cancelNode(contextMenu.id);
                setContextMenu(null);
                notify('已暂停当前生成，可右键重试');
              }}><Pause size={14} />暂停</button>
              <button type="button" role="menuitem" disabled={engine.isNodeRunning(contextMenu.id)} onClick={() => {
                const nodeId = contextMenu.id;
                setContextMenu(null);
                void runGenerationNode(nodeId);
              }}><RotateCcw size={14} />重试</button>
              <button className="is-danger" type="button" role="menuitem" onClick={() => {
                engine.removeNodes([contextMenu.id]);
                setContextMenu(null);
                notify('已删除节点');
              }}><Trash2 size={14} />删除节点</button>
            </>}
          </div>}

          <div className="fc-canvas-actions" aria-label="画布操作">
            {saveState && <span className={`fc-save-state is-${saveState.status}`}><i />{saveStateText(saveState)}</span>}
            {!readOnly && <button className="fc-json-action" type="button" title="导入 JSON" aria-label="导入 JSON" onClick={() => importInput.current?.click()}><Upload size={14} /><span>导入 JSON</span></button>}
            {!readOnly && <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={event => { void importFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />}
            <button className="fc-json-action" type="button" title="导出 JSON" aria-label="导出 JSON" onClick={download}><Download size={14} /><span>导出 JSON</span></button>
            <button type="button" title="切换主题" aria-label="切换主题" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</button>
            <button type="button" title="属性面板" onClick={() => setInspectorOpen(value => !value)}><PanelRight size={14} /></button>
            {services?.assistant && <button type="button" title="AI 助手" onClick={() => { setInspectorOpen(true); setInspectorTab('assistant'); }}><Bot size={14} /></button>}
            <button className="fc-run-button" type="button" onClick={running ? () => engine.cancel() : () => void run()}>{running ? <><Minus size={14} />停止</> : <><CirclePlay size={14} />运行全部</>}</button>
          </div>

          <nav className={`fc-rail${railCollapsed ? ' is-collapsed' : ''}`} aria-label="生成节点入口" aria-expanded={!railCollapsed}>
            <button
              className="fc-rail__toggle"
              type="button"
              title={railCollapsed ? '展开节点抽屉' : '收起节点抽屉'}
              aria-label={railCollapsed ? '展开节点抽屉' : '收起节点抽屉'}
              onClick={() => setRailCollapsed(value => !value)}
            >
              {railCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              <span>{railCollapsed ? '展开' : '收起'}</span>
            </button>
            {!railCollapsed && <>
              <button type="button" title="添加空白节点" disabled={readOnly || !engine.registry.has('blank')} onClick={() => addAtCenter('blank')}><SquarePlus size={17} /><span>空白</span></button>
              <button type="button" title="添加文本节点" disabled={readOnly || !engine.registry.has('prompt')} onClick={() => addAtCenter('prompt')}><FileText size={17} /><span>文本</span></button>
              <button type="button" title="添加图片节点" disabled={readOnly || !engine.registry.has('image')} onClick={() => addAtCenter('image')}><ImageIcon size={17} /><span>图片</span></button>
              <button type="button" title="添加视频节点" disabled={readOnly || !engine.registry.has('video')} onClick={() => addAtCenter('video')}><Clapperboard size={17} /><span>视频</span></button>
              <button type="button" title="添加音频节点" disabled={readOnly || !engine.registry.has('audio')} onClick={() => addAtCenter('audio')}><AudioLines size={17} /><span>音频</span></button>
              {services?.assets && <button type="button" title="上传素材" disabled={readOnly || importingAssets} onClick={openAssetPicker}><Upload size={17} /><span>上传</span></button>}
              <i className="fc-rail__divider" aria-hidden="true" />
              <button className="fc-rail__save" type="button" title={selectedExportAssets.length ? `保存选中素材（${selectedExportAssets.length}）` : '请先选择需要保存的素材'} disabled={!selectedExportAssets.length} onClick={() => { void exportSelectedAssets(); }}><Download size={17} /><span>保存</span></button>
              {services?.assets && <input
                ref={assetInput}
                type="file"
                accept={services.assets.accept}
                multiple
                hidden
                onChange={event => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  if (files.length) void importAssets(files, getCanvasCenter(), 'picker', selectedMediaTarget());
                  event.currentTarget.value = '';
                }}
              />}
            </>}
          </nav>

          {libraryOpen && <aside className="fc-library">
            <header><strong>添加到画布</strong><button type="button" onClick={() => setLibraryOpen(false)}>×</button></header>
            {services?.assets && <>
              <button className="fc-upload-tile" type="button" disabled={importingAssets} onClick={openAssetPicker}><FilePlus2 size={14} /><span><strong>{importingAssets ? '正在导入素材' : '上传图片或视频'}</strong><small>也可以直接拖入画布</small></span></button>
              <input
                ref={assetInput}
                type="file"
                accept={services.assets.accept}
                multiple
                hidden
                onChange={event => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  if (files.length) void importAssets(files, getCanvasCenter(), 'picker', selectedMediaTarget());
                  event.currentTarget.value = '';
                }}
              />
            </>}
            <p>节点</p>
            {engine.registry.list().map(definition => <button
              className="fc-library__item"
              type="button"
              key={definition.type}
              draggable={!readOnly}
              onDragStart={event => { event.dataTransfer.setData('application/flowcanvas-node', definition.type); event.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => addAtCenter(definition.type)}
            ><span style={{ color: definition.color }}><Boxes size={14} /></span><span><strong>{definition.title}</strong><small>{definition.description}</small></span><SquarePlus size={12} /></button>)}
          </aside>}

          <div className="fc-canvas-tools">
            <button className={interactionMode === 'select' ? 'is-active' : ''} type="button" title="选择" aria-pressed={interactionMode === 'select'} onClick={() => setInteractionMode('select')}><MousePointer2 size={14} /></button>
            <button className={interactionMode === 'pan' ? 'is-active' : ''} type="button" title="平移" aria-pressed={interactionMode === 'pan'} onClick={() => setInteractionMode('pan')}><Hand size={14} /></button>
            <button type="button" title="撤销" disabled={readOnly || (!engine.history.canUndo && !hasPendingDraft)} onClick={() => {
              if (readOnly) return;
              pendingDraftCommit.current?.();
              pendingDraftCommit.current = undefined;
              engine.undo();
            }}><Undo2 size={14} /></button>
            <button type="button" title="重做" disabled={readOnly || !engine.history.canRedo} onClick={() => { if (!readOnly) engine.redo(); }}><Redo2 size={14} /></button>
            <button
              className="fc-canvas-delete"
              type="button"
              title="删除选中节点或连线"
              aria-label="删除选中"
              disabled={readOnly || (!selection.nodeIds.length && !selection.edgeIds.length)}
              onClick={deleteSelection}
            ><Trash2 size={14} /></button>
            {selection.edgeIds.length > 0 && <button
              className="fc-canvas-unlink"
              type="button"
              title="取消选中的连线"
              aria-label="取消选中的连线"
              disabled={readOnly}
              onClick={() => {
                const edgeIds = [...selection.edgeIds];
                engine.removeEdges(edgeIds);
                notify(`已取消 ${edgeIds.length} 条连线`);
              }}
            ><Unlink2 size={14} /></button>}
            <i />
            <button type="button" title="缩小" onClick={() => reactFlow.zoomOut()}><Minus size={13} /></button>
            <span className="fc-canvas-zoom" aria-label={`当前缩放 ${Math.round(viewport.zoom * 100)}%`}>{Math.round(viewport.zoom * 100)}%</span>
            <button type="button" title="适应画布" onClick={() => reactFlow.fitView({ padding: .16, duration: 280 })}><Maximize size={14} /></button>
            <button type="button" title="放大" onClick={() => reactFlow.zoomIn()}><Plus size={13} /></button>
          </div>
          {toast && <div className="fc-toast"><CheckCircle2 size={13} />{toast}</div>}
        </section>

        {inspectorOpen && <Inspector
          engine={engine}
          node={selectedNode}
          definition={selectedDefinition}
          issues={validation.issues}
          onClose={() => setInspectorOpen(false)}
          readOnly={readOnly}
          renderer={selectedNode ? ownValue(renderers?.inspectors, selectedNode.type) : undefined}
          assistant={services?.assistant}
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          onDraftChange={handleDraftChange}
        />}
      </main>

      <footer className="fc-statusbar"><span><i />画布引擎就绪</span><span>{selection.nodeIds.length ? `已选择 ${selection.nodeIds.length} 个节点` : '未选择节点'}</span><span>{graph.nodes.length} 节点 · {graph.edges.length} 连线 · {validation.valid ? '校验通过' : `${validation.issues.length} 项问题`}</span></footer>
    </div>
  );
}

export function FlowCanvasApp(props: FlowCanvasAppProps) {
  return <ReactFlowProvider><CanvasWorkspace {...props} /></ReactFlowProvider>;
}
