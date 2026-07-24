import type { CanvasNode, CanvasNodeData, GraphDocument, Point } from './core/types';
import type { RuntimeConfigurationRequiredLike } from './runtime/errors';

export interface FlowCanvasAssetNode {
  type: string;
  position?: Point;
  data?: Partial<CanvasNodeData>;
}

export interface FlowCanvasAssetRequest {
  /** Distinguishes the browser/Electron file picker from a native drag-and-drop operation. */
  source: 'picker' | 'drop';
  files?: readonly File[];
  accept?: string;
  graph: GraphDocument;
  position: Point;
  /** When a file is dropped on a node or a node is selected before picking files, hosts can tailor drafts for that target. */
  targetNodeId?: string;
  signal: AbortSignal;
}

export interface FlowCanvasAssetService {
  /** Passed to the renderer's file input; native Electron bridges can ignore it. */
  accept?: string;
  /** Convert renderer File objects into registered canvas-node drafts. */
  pickFiles: (
    request: FlowCanvasAssetRequest,
  ) => readonly FlowCanvasAssetNode[] | Promise<readonly FlowCanvasAssetNode[]>;
}

export interface FlowCanvasAssistantRequest {
  message: string;
  graph: GraphDocument;
  node?: CanvasNode;
  signal: AbortSignal;
}

export interface FlowCanvasAssistantReply {
  message: string;
}

export interface FlowCanvasAssistantService {
  /** Implement this in the host app (HTTP, preload IPC, or an in-process adapter). */
  send: (
    request: FlowCanvasAssistantRequest,
  ) => string | FlowCanvasAssistantReply | Promise<string | FlowCanvasAssistantReply>;
}

export interface FlowCanvasConfigurationService {
  /** Ask the host to open its own configuration UI before the next run. */
  onRequired: (error: RuntimeConfigurationRequiredLike) => void | Promise<void>;
}

export interface FlowCanvasServices {
  assets?: FlowCanvasAssetService;
  assistant?: FlowCanvasAssistantService;
  configuration?: FlowCanvasConfigurationService;
}

export interface SaveState {
  /** Host-controlled persistence state shown in the document header. */
  status: 'idle' | 'saving' | 'saved' | 'error';
  message?: string;
}
