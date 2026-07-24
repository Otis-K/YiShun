import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  AudioLines,
  Clapperboard,
  FileText,
  FileUp,
  Image as ImageIcon,
  PanelTopClose,
  Play,
} from 'lucide-react';
import type { MutationOptions } from '../core/engine';
import type { CanvasNodeData, GraphDocument, NodeDefinition } from '../core/types';
import { isGenerationMode, isGenerationNodeType, type GenerationMode } from '../generation';
import type { FlowCanvasNodeRenderer, FlowCanvasReadonlyNode } from './extensions';
import { GenerationNodePanel, type GenerationReference } from './GenerationNodePanel';
import { PluginBoundary } from './PluginBoundary';
import { VideoPreview } from './VideoPreview';

export interface FlowNodeData extends CanvasNodeData {
  definition: NodeDefinition;
  node: FlowCanvasReadonlyNode;
  renderer?: FlowCanvasNodeRenderer;
  onRendererError: (error: Error) => void;
  readOnly: boolean;
  running: boolean;
  onUpdateData: (patch: Partial<CanvasNodeData>, options?: MutationOptions) => void;
  onCaptureSnapshot: () => GraphDocument;
  onCommitSnapshot: (label: string, before: GraphDocument) => void;
  onDraftChange: (active: boolean, commit?: () => void) => void;
  onChangeGenerationMode: (mode: GenerationMode) => void;
  onRunNode: () => void;
  onCancelRun: () => void;
  onNotify: (message: string) => void;
  getReferences: () => GenerationReference[];
  connectedReferences: GenerationReference[];
  onDisconnectReference: (sourceNodeId: string, targetPort?: string, edgeId?: string) => void;
}

export type FlowNodeModel = Node<FlowNodeData, 'flowcanvas'>;

const iconMap = {
  text: FileText,
  image: ImageIcon,
  video: Clapperboard,
  audio: AudioLines,
  output: PanelTopClose,
};

const statusLabel = {
  idle: '待运行',
  queued: '队列中',
  running: '运行中',
  success: '已完成',
  error: '失败',
  cancelled: '已取消',
};

const ownMapValue = <T,>(record: Record<string, T>, key: string): T | undefined => (
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
);

const mediaKindFromData = (data: CanvasNodeData): 'image' | 'video' | 'audio' | undefined => {
  const explicit = data.previewKind ?? data.mediaType ?? data.assetKind;
  if (explicit === 'image' || explicit === 'video' || explicit === 'audio') return explicit;
  const mimeType = typeof data.mimeType === 'string' ? data.mimeType : '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return undefined;
};

type EmbeddedMediaItem = Record<string, unknown>;

const isRecord = (value: unknown): value is EmbeddedMediaItem => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const mediaKindFromItem = (item: EmbeddedMediaItem): 'image' | 'video' | 'audio' | undefined => {
  const explicit = item.kind ?? item.previewKind ?? item.mediaType ?? item.assetKind;
  if (explicit === 'image' || explicit === 'video' || explicit === 'audio') return explicit;
  const mimeType = typeof item.mimeType === 'string' ? item.mimeType : '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return undefined;
};

const embeddedMediaFromData = (data: CanvasNodeData): EmbeddedMediaItem[] => (
  Array.isArray(data.embeddedMedia)
    ? data.embeddedMedia.filter(isRecord)
    : []
);

const sourceFromItem = (item: EmbeddedMediaItem): string => (
  typeof item.preview === 'string' ? item.preview : typeof item.url === 'string' ? item.url : ''
);

const labelFromItem = (item: EmbeddedMediaItem, fallback: string): string => (
  String(item.name ?? item.fileName ?? item.title ?? fallback)
);

function NodeMediaPreview({ src, kind, title }: { src: string; kind?: 'image' | 'video' | 'audio'; title: string }) {
  if (kind === 'video') {
    return <VideoPreview src={src} title={title} className="fc-node__preview fc-node__preview--video" />;
  }
  if (kind === 'audio') {
    return <div className="fc-node__preview fc-node__preview--audio fc-node__drag-zone nodrag nowheel">
      <audio src={src} controls preload="metadata" aria-label={`${title}音频预览`} />
    </div>;
  }
  return <img className="fc-node__preview fc-node__drag-zone" src={src} width="232" height="124" alt={`${title}预览`} />;
}

function BlankMediaPlaceholder() {
  return <div className="fc-node__preview fc-node__blank-preview fc-node__drag-zone">
    <FileUp size={28} />
    <span>拖入图片、视频或音频</span>
  </div>;
}

function EmbeddedMediaStack({ items, title }: { items: EmbeddedMediaItem[]; title: string }) {
  if (items.length === 1) {
    const item = items[0];
    return <NodeMediaPreview src={sourceFromItem(item)} kind={mediaKindFromItem(item)} title={labelFromItem(item, title)} />;
  }
  return <div className="fc-node__media-stack fc-node__drag-zone" data-media-count={items.length}>
    {items.slice(0, 4).map((item, index) => {
      const source = sourceFromItem(item);
      const kind = mediaKindFromItem(item);
      if (!source || !kind) return null;
      return <figure className="fc-node__media-item" key={`${source}-${index}`}>
        <NodeMediaPreview src={source} kind={kind} title={labelFromItem(item, `${title} ${index + 1}`)} />
        <figcaption>{labelFromItem(item, `素材 ${index + 1}`)}</figcaption>
      </figure>;
    })}
    {items.length > 4 && <span className="fc-node__media-more">+{items.length - 4}</span>}
  </div>;
}

export const FlowNode = memo(({ data, selected }: NodeProps<FlowNodeModel>) => {
  const definition = data.definition;
  const CustomRenderer = data.renderer;
  const Icon = ownMapValue(iconMap, definition.icon ?? 'text') ?? FileText;
  const status = data.status ?? 'idle';
  const preview = typeof data.preview === 'string' ? data.preview : undefined;
  const embeddedMedia = embeddedMediaFromData(data).filter(item => sourceFromItem(item) && mediaKindFromItem(item));
  const mediaItems = embeddedMedia.length
    ? embeddedMedia
    : preview
      ? [{ preview, previewKind: mediaKindFromData(data), name: data.fileName ?? data.title }]
      : [];
  const previewKind = mediaItems.length ? mediaKindFromItem(mediaItems[0]) : mediaKindFromData(data);
  const generationNode = isGenerationNodeType(definition.type) || isGenerationMode(data.generationMode);
  const blankNode = definition.type === 'blank';
  const mediaNode = !generationNode && (blankNode || Boolean(mediaItems.length && (previewKind === 'image' || previewKind === 'video' || previewKind === 'audio')));
  const mediaClassKind = previewKind ?? (blankNode ? 'blank' : 'asset');
  const portStart = generationNode ? 82 : mediaNode ? 138 : 48;

  return (
    <article className={`fc-node fc-node--${status}${generationNode ? ' fc-node--generation' : ''}${mediaNode ? ` fc-node--media fc-node--media-${mediaClassKind}` : ''}${selected ? ' is-selected' : ''}`} data-node-type={definition.type}>
      {definition.inputs.length > 0 && (() => {
        return (
        <Handle
          key="__auto_input__"
          id="__auto_input__"
          type="target"
          position={Position.Left}
          className="fc-port fc-port--input fc-port--auto"
          isConnectable={!data.readOnly}
          style={{ top: portStart }}
          title="智能素材输入"
        />
        );
      })()}
      {definition.outputs.length > 0 && (() => {
        return (
        <Handle
          key="__auto_output__"
          id="__auto_output__"
          type="source"
          position={Position.Right}
          className="fc-port fc-port--output fc-port--auto"
          isConnectable={!data.readOnly}
          style={{ top: portStart }}
          title="智能素材输出"
        />
        );
      })()}

      {CustomRenderer ? (
        <div className="fc-node__custom">
          <PluginBoundary
            resetKey={CustomRenderer}
            fallback={<p className="fc-node__error">自定义节点渲染失败</p>}
            onError={error => data.onRendererError(error)}
          >
            <CustomRenderer node={data.node} definition={definition} selected={selected} readOnly={data.readOnly} />
          </PluginBoundary>
        </div>
      ) : generationNode ? (
        <GenerationNodePanel
          node={data.node}
          definition={definition}
          readOnly={data.readOnly}
          running={data.running}
          onUpdateData={data.onUpdateData}
          onCaptureSnapshot={data.onCaptureSnapshot}
          onCommitSnapshot={data.onCommitSnapshot}
          onDraftChange={data.onDraftChange}
          onChangeMode={data.onChangeGenerationMode}
          onRun={data.onRunNode}
          onCancel={data.onCancelRun}
          onNotify={data.onNotify}
          getReferences={data.getReferences}
          connectedReferences={data.connectedReferences}
          onDisconnectReference={data.onDisconnectReference}
        />
      ) : <>
        <header className="fc-node__header fc-node__drag-zone">
          <span className="fc-node__icon" style={{ color: definition.color }}><Icon size={13} /></span>
          <strong>{data.title}</strong>
          <span className={`fc-node__status fc-node__status--${status}`}><i />{ownMapValue(statusLabel, status) ?? '未知状态'}</span>
        </header>

        {mediaItems.length
          ? <EmbeddedMediaStack items={mediaItems} title={String(data.title || definition.title)} />
          : blankNode
            ? <BlankMediaPlaceholder />
            : null}
        <div className="fc-node__body">
          {data.prompt && <p>{String(data.prompt)}</p>}
          {!data.prompt && !mediaItems.length && !blankNode && <p>{data.description ?? definition.description}</p>}
          {status === 'running' && (
            <div className="fc-node__progress"><span style={{ width: `${Math.round((data.progress ?? 0) * 100)}%` }} /></div>
          )}
          {Boolean(data.runError) && <p className="fc-node__error">{String(data.runError)}</p>}
          <footer>
            <span>{definition.category}</span>
            <span>{status === 'running' ? `${Math.round((data.progress ?? 0) * 100)}%` : <><Play size={9} /> {definition.type}</>}</span>
          </footer>
        </div>
      </>}
    </article>
  );
});

FlowNode.displayName = 'FlowNode';
