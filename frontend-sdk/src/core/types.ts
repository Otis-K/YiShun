export const CURRENT_SCHEMA_VERSION = 1 as const;

export type NodeId = string;
export type EdgeId = string;
export type PortDataType = 'any' | 'text' | 'image' | 'video' | 'audio' | 'json' | (string & {});
export type NodeRunStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'cancelled';

export interface Point {
  x: number;
  y: number;
}

export interface ViewportState extends Point {
  zoom: number;
}

/** Axis-aligned rectangle in canvas coordinates. */
export interface CanvasRect extends Point {
  width: number;
  height: number;
}

export interface PortDefinition {
  id: string;
  label: string;
  dataType: PortDataType;
  required?: boolean;
  multiple?: boolean;
}

export interface CanvasNodeData extends Record<string, unknown> {
  title: string;
  description?: string;
  prompt?: string;
  status?: NodeRunStatus;
  progress?: number;
  retryCount?: number;
  cache?: boolean;
}

export interface CanvasNode<TData extends CanvasNodeData = CanvasNodeData> {
  id: NodeId;
  type: string;
  position: Point;
  data: TData;
  width?: number;
  height?: number;
  parentId?: NodeId;
  locked?: boolean;
}

export interface CanvasEdge {
  id: EdgeId;
  source: NodeId;
  sourcePort: string;
  target: NodeId;
  targetPort: string;
  label?: string;
  data?: Record<string, unknown>;
}

export interface GraphDocument {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  id: string;
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: ViewportState;
  metadata: Record<string, unknown>;
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

/** A zero-copy view. Treat the returned object as immutable. */
export type ReadonlyGraphDocument = DeepReadonly<GraphDocument>;

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode =
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'UNKNOWN_NODE_TYPE'
  | 'MISSING_SOURCE_NODE'
  | 'MISSING_TARGET_NODE'
  | 'MISSING_SOURCE_PORT'
  | 'MISSING_TARGET_PORT'
  | 'SELF_CONNECTION'
  | 'DUPLICATE_CONNECTION'
  | 'PORT_TYPE_MISMATCH'
  | 'PORT_CARDINALITY'
  | 'REQUIRED_INPUT_MISSING'
  | 'CYCLE_DETECTED'
  | 'NODE_CONFIGURATION_INVALID';

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  nodeId?: NodeId;
  edgeId?: EdgeId;
  portId?: string;
  details?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface NodeExecutionContext<TData extends CanvasNodeData = CanvasNodeData> {
  node: CanvasNode<TData>;
  inputs: Record<string, unknown>;
  signal: AbortSignal;
  emitProgress: (progress: number, message?: string) => void;
  /** True only for nodes explicitly retried by the user. Upstream dependencies remain cacheable. */
  forceRefresh?: boolean;
}

export type NodeExecutor<TData extends CanvasNodeData = CanvasNodeData> = (
  context: NodeExecutionContext<TData>,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface NodeDefinition<TData extends CanvasNodeData = CanvasNodeData> {
  type: string;
  title: string;
  category: string;
  description?: string;
  color?: string;
  icon?: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  createData: () => TData;
  validate?: (node: CanvasNode<TData>) => ValidationIssue[];
  execute?: NodeExecutor<TData>;
}

export interface RuntimeNodeState {
  nodeId: NodeId;
  status: NodeRunStatus;
  progress: number;
  message?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  attempts: number;
  cached?: boolean;
}

export interface WorkflowRunResult {
  runId: string;
  status: 'success' | 'error' | 'cancelled';
  nodeStates: Record<NodeId, RuntimeNodeState>;
  outputs: Record<NodeId, Record<string, unknown>>;
  startedAt: number;
  endedAt: number;
  error?: string;
}

export interface RuntimeOptions {
  useCache?: boolean;
  stopOnError?: boolean;
  /** Nodes that must execute again even when the rest of the graph may use cached outputs. */
  refreshNodeIds?: readonly NodeId[];
}

export interface GraphChangeEvent {
  graph: GraphDocument;
  label: string;
}

export interface EngineEventMap {
  'graph:change': GraphChangeEvent;
  'selection:change': { nodeIds: string[]; edgeIds: string[] };
  'validation:change': ValidationResult;
  'autosave:status': {
    state: 'idle' | 'pending' | 'saving' | 'saved' | 'error';
    revision: number;
    savedRevision: number;
    error?: string;
  };
  'run:start': { runId: string; nodeIds: string[] };
  'run:node': RuntimeNodeState;
  'run:end': WorkflowRunResult;
  'error': { error: Error; source: string };
}

export type EngineEventName = keyof EngineEventMap;

export interface SelectionState {
  nodeIds: string[];
  edgeIds: string[];
}

export interface ClipboardPayload {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
