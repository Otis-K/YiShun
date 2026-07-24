import { TypedEventBus } from './events';
import { CommandHistory } from './history';
import { NodeRegistry } from './registry';
import {
  cloneGraph,
  createEmptyGraph,
  deserializeGraph,
  serializeGraph,
  assertJsonSerializable,
  type GraphMigrationRegistry,
} from './serialization';
import { SpatialIndex } from './spatial-index';
import { validateGraph, GraphValidationError } from './validation';
import type {
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  CanvasRect,
  ClipboardPayload,
  EngineEventMap,
  EngineEventName,
  GraphDocument,
  NodeDefinition,
  RuntimeNodeState,
  RuntimeOptions,
  ReadonlyGraphDocument,
  SelectionState,
  ValidationResult,
  ViewportState,
  WorkflowRunResult,
} from './types';
import { LocalWorkflowRuntime } from '../runtime/local-runtime';
import type { WorkflowRuntime } from '../runtime/local-runtime';

export interface CanvasEngineOptions {
  graph?: GraphDocument;
  migrations?: GraphMigrationRegistry;
  historyLimit?: number;
  runtime?: WorkflowRuntime;
  readOnly?: boolean;
}

export interface MutationOptions {
  record?: boolean;
  /** Update render state only; suppress graph/validation events until commitSnapshot. */
  transient?: boolean;
}

export interface CommandHistoryView {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel?: string;
  readonly redoLabel?: string;
}

export type CanvasNodePatch = Partial<Omit<CanvasNode, 'id' | 'data'>> & {
  data?: Partial<CanvasNodeData>;
};

export interface CanvasCommand<TResult = void> {
  label: string;
  execute: (engine: CanvasEngine) => TResult;
}

export type EdgeInput = Omit<CanvasEdge, 'id'> & { id?: string };

interface EngineSnapshot {
  graph: GraphDocument;
  selection: SelectionState;
}

interface ActiveRun {
  token: symbol;
  runId: string;
  controller: AbortController;
  nodeIds: Set<string>;
}

interface TransactionContext {
  label: string;
  record: boolean;
  before: EngineSnapshot;
  graphTouched: boolean;
  selectionTouched: boolean;
}

interface InternalMutationOptions {
  record?: boolean;
  transient?: boolean;
  selection?: SelectionState;
  affectsSpatialIndex?: boolean;
  affectsValidation?: boolean;
  allowReadOnly?: boolean;
}

const sameGraph = (a: GraphDocument, b: GraphDocument) => JSON.stringify(a) === JSON.stringify(b);

const sameSelection = (a: SelectionState, b: SelectionState): boolean => (
  a.nodeIds.length === b.nodeIds.length
  && a.edgeIds.length === b.edgeIds.length
  && a.nodeIds.every((id, index) => id === b.nodeIds[index])
  && a.edgeIds.every((id, index) => id === b.edgeIds[index])
);

const assertFinitePoint = (
  point: { x: number; y: number },
  label: string,
  allowedKeys: ReadonlySet<string> = new Set(['x', 'y']),
): void => {
  if (!point || typeof point !== 'object' || Array.isArray(point)
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(`${label} coordinates must be finite numbers.`);
  }
  for (const key of Reflect.ownKeys(point)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new TypeError(`${label} contains an unsupported property: ${String(key)}.`);
    }
  }
};

const assertOptionalSize = (value: number | undefined, label: string): void => {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new RangeError(`${label} must be finite and greater than zero.`);
  }
};

const nodePatchKeys = new Set(['type', 'position', 'data', 'width', 'height', 'parentId', 'locked']);

const normalizeRuntimeResult = (
  value: WorkflowRunResult,
  expectedRunId: string,
  nodeIds: ReadonlySet<string>,
): WorkflowRunResult => {
  const result = structuredClone(value) as WorkflowRunResult;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('Runtime result must be an object.');
  if (result.runId !== expectedRunId) throw new Error(`Runtime returned an unexpected runId: ${String(result.runId)}.`);
  if (!['success', 'error', 'cancelled'].includes(result.status)) throw new TypeError(`Invalid runtime status: ${String(result.status)}.`);
  if (!result.nodeStates || typeof result.nodeStates !== 'object' || Array.isArray(result.nodeStates)) {
    throw new TypeError('Runtime result nodeStates must be an object.');
  }
  if (!result.outputs || typeof result.outputs !== 'object' || Array.isArray(result.outputs)) {
    throw new TypeError('Runtime result outputs must be an object.');
  }
  if (!Number.isFinite(result.startedAt) || !Number.isFinite(result.endedAt) || result.endedAt < result.startedAt) {
    throw new TypeError('Runtime result timestamps must be finite and ordered.');
  }
  result.nodeStates = Object.fromEntries(Object.entries(result.nodeStates).map(([nodeId, state]) => {
    const normalized = normalizeRuntimeNodeState(state, nodeIds);
    if (normalized.nodeId !== nodeId) throw new TypeError(`Runtime nodeStates key "${nodeId}" does not match nodeId "${normalized.nodeId}".`);
    return [nodeId, normalized];
  }));
  for (const [nodeId, output] of Object.entries(result.outputs)) {
    if (!nodeIds.has(nodeId)) throw new TypeError(`Runtime returned output for unknown node: ${nodeId}.`);
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      throw new TypeError(`Runtime output for node "${nodeId}" must be an object.`);
    }
  }
  return result;
};

const runtimeStatuses = new Set<RuntimeNodeState['status']>([
  'idle', 'queued', 'running', 'success', 'error', 'cancelled',
]);

const normalizeRuntimeNodeState = (
  value: RuntimeNodeState,
  nodeIds: ReadonlySet<string>,
): RuntimeNodeState => {
  const state = structuredClone(value) as RuntimeNodeState;
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Runtime node state must be an object.');
  if (typeof state.nodeId !== 'string' || !nodeIds.has(state.nodeId)) {
    throw new TypeError(`Runtime state references an unknown node: ${String(state.nodeId)}.`);
  }
  if (!runtimeStatuses.has(state.status)) throw new TypeError(`Invalid runtime node status: ${String(state.status)}.`);
  if (!Number.isFinite(state.progress) || state.progress < 0 || state.progress > 1) {
    throw new RangeError('Runtime node progress must be finite and between zero and one.');
  }
  if (!Number.isSafeInteger(state.attempts) || state.attempts < 0) {
    throw new RangeError('Runtime node attempts must be a non-negative safe integer.');
  }
  for (const key of ['message', 'error'] as const) {
    if (state[key] !== undefined && typeof state[key] !== 'string') throw new TypeError(`Runtime node ${key} must be a string.`);
  }
  for (const key of ['startedAt', 'endedAt'] as const) {
    if (state[key] !== undefined && !Number.isFinite(state[key])) throw new RangeError(`Runtime node ${key} must be finite.`);
  }
  if (state.cached !== undefined && typeof state.cached !== 'boolean') throw new TypeError('Runtime node cached must be boolean.');
  return state;
};

const terminalRuntimeStatuses = new Set<RuntimeNodeState['status']>([
  'success', 'error', 'cancelled',
]);

/**
 * A final workflow result is authoritative. Adapters may stream only some
 * states (or no states), so complete every run node and ensure no node remains
 * visually queued/running after run:end.
 */
const completeRuntimeResult = (
  result: WorkflowRunResult,
  nodeIds: ReadonlySet<string>,
  reportedStates: ReadonlyMap<string, RuntimeNodeState>,
): WorkflowRunResult => {
  const nodeStates = Object.create(null) as Record<string, RuntimeNodeState>;
  for (const nodeId of nodeIds) {
    const state = result.nodeStates[nodeId] ?? reportedStates.get(nodeId);
    if (state && terminalRuntimeStatuses.has(state.status)) {
      nodeStates[nodeId] = state;
      continue;
    }

    const status: RuntimeNodeState['status'] = result.status === 'success'
      ? 'success'
      : result.status === 'cancelled'
        ? 'cancelled'
        : 'error';
    nodeStates[nodeId] = {
      nodeId,
      status,
      progress: status === 'success' ? 1 : (state?.progress ?? 0),
      attempts: state?.attempts ?? 0,
      startedAt: state?.startedAt ?? result.startedAt,
      endedAt: state?.endedAt ?? result.endedAt,
      message: state?.message,
      error: status === 'error' ? (state?.error ?? result.error ?? 'Workflow execution failed.') : undefined,
      cached: state?.cached,
    };
  }
  return { ...result, nodeStates };
};

const createReadonlyView = <T extends object>(root: T): T => {
  const cache = new WeakMap<object, object>();
  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    const cached = cache.get(value);
    if (cached) return cached;
    const proxy = new Proxy(value, {
      get: (target, property, receiver) => wrap(Reflect.get(target, property, receiver)),
      getOwnPropertyDescriptor: (target, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (!descriptor || !('value' in descriptor)) return descriptor;
        if (descriptor.configurable === false && descriptor.writable === false) return descriptor;
        return { ...descriptor, value: wrap(descriptor.value) };
      },
      set: () => { throw new TypeError('FlowCanvas graph snapshots are read-only.'); },
      deleteProperty: () => { throw new TypeError('FlowCanvas graph snapshots are read-only.'); },
      defineProperty: () => { throw new TypeError('FlowCanvas graph snapshots are read-only.'); },
      setPrototypeOf: () => { throw new TypeError('FlowCanvas graph snapshots are read-only.'); },
      preventExtensions: () => { throw new TypeError('FlowCanvas graph snapshots are read-only.'); },
    });
    cache.set(value, proxy);
    return proxy;
  };
  return wrap(root) as T;
};

export class CanvasReadOnlyError extends Error {
  readonly code = 'CANVAS_READ_ONLY' as const;

  constructor(readonly operation: string) {
    super(`Canvas is read-only; operation is not allowed: ${operation}.`);
    this.name = 'CanvasReadOnlyError';
  }
}

export class CanvasEngineDestroyedError extends Error {
  readonly code = 'CANVAS_ENGINE_DESTROYED' as const;

  constructor() {
    super('Canvas engine has been destroyed and can no longer be used.');
    this.name = 'CanvasEngineDestroyedError';
  }
}

export class CanvasEngine {
  readonly registry = new NodeRegistry();
  readonly events = new TypedEventBus();
  readonly history: CommandHistoryView;

  private graph: GraphDocument;
  private readonly commandHistory: CommandHistory;
  private selection: SelectionState = { nodeIds: [], edgeIds: [] };
  private clipboard?: ClipboardPayload;
  private readonly runtime: WorkflowRuntime;
  private readonly migrations?: GraphMigrationRegistry;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly listeners = new Set<() => void>();
  private readonly spatialIndex = new SpatialIndex();
  private spatialNodeMap = new Map<string, CanvasNode>();
  private spatialIndexDirty = true;
  private transactionContext?: TransactionContext;
  private validationCache?: ValidationResult;
  private validationRegistryRevision = -1;
  private validationDeferredDirty = false;
  private readonlyViewSource?: GraphDocument;
  private readonlyView?: ReadonlyGraphDocument;
  private readOnly: boolean;
  private version = 0;
  private destroyed = false;

  constructor(options: CanvasEngineOptions = {}) {
    this.migrations = options.migrations;
    this.graph = options.graph
      ? deserializeGraph(options.graph, options.migrations)
      : createEmptyGraph();
    this.commandHistory = new CommandHistory(options.historyLimit ?? 100);
    const history = this.commandHistory;
    this.history = Object.freeze({
      get canUndo() { return history.canUndo; },
      get canRedo() { return history.canRedo; },
      get undoLabel() { return history.undoLabel; },
      get redoLabel() { return history.redoLabel; },
    });
    this.runtime = options.runtime ?? new LocalWorkflowRuntime();
    this.readOnly = options.readOnly ?? false;
    this.rebuildSpatialIndex();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.assertAlive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => {
    this.assertAlive();
    return this.version;
  };

  on<K extends EngineEventName>(event: K, listener: (payload: EngineEventMap[K]) => void): () => void {
    this.assertAlive();
    return this.events.on(event, listener);
  }

  setReadOnly(readOnly: boolean): void {
    this.assertAlive();
    if (this.readOnly === readOnly) return;
    this.readOnly = readOnly;
    this.notify();
  }

  isReadOnly(): boolean {
    this.assertAlive();
    return this.readOnly;
  }

  getGraph(): GraphDocument {
    this.assertAlive();
    return cloneGraph(this.graph);
  }

  /** Zero-copy graph view for render hot paths. The SDK never grants mutable typing for it. */
  getGraphSnapshot(): ReadonlyGraphDocument {
    this.assertAlive();
    if (this.readonlyViewSource !== this.graph || !this.readonlyView) {
      this.readonlyViewSource = this.graph;
      this.readonlyView = createReadonlyView(this.graph) as ReadonlyGraphDocument;
    }
    return this.readonlyView;
  }

  exportGraph(space = 2): string {
    this.assertAlive();
    return serializeGraph(this.graph, space);
  }

  importGraph(input: string | GraphDocument): void {
    this.assertWritable('导入工作流');
    try {
      this.graph = deserializeGraph(input, this.migrations);
      this.selection = { nodeIds: [], edgeIds: [] };
      this.commandHistory.clear();
      this.validationCache = undefined;
      this.validationDeferredDirty = false;
      this.rebuildSpatialIndex();
      this.changed('导入工作流');
      this.emitSelection();
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.events.emit('error', { error, source: 'graph:import' });
      throw error;
    }
  }

  registerNodeType<TData extends CanvasNodeData>(definition: NodeDefinition<TData>): () => void {
    this.assertAlive();
    const unregister = this.registry.register(definition);
    this.validationCache = undefined;
    this.validationDeferredDirty = false;
    this.notify();
    return () => {
      unregister();
      this.validationCache = undefined;
      this.validationDeferredDirty = false;
      this.notify();
    };
  }

  addNode(type: string, position: { x: number; y: number }, data?: Partial<CanvasNodeData>): CanvasNode {
    this.assertWritable('添加节点');
    assertFinitePoint(position, 'Node position');
    const definition = this.registry.require(type);
    const nodeData = structuredClone({ ...definition.createData(), ...data, title: data?.title ?? definition.title });
    if (!nodeData || typeof nodeData !== 'object' || typeof nodeData.title !== 'string') {
      throw new TypeError(`Node type "${type}" must create object data with a string title.`);
    }
    assertJsonSerializable(nodeData, `node(${type}).data`);
    const node: CanvasNode = {
      id: crypto.randomUUID(),
      type,
      position: { x: position.x, y: position.y },
      data: nodeData,
    };
    const indexWasCurrent = !this.spatialIndexDirty;
    this.mutate('添加节点', graph => graph.nodes.push(node), {
      selection: { nodeIds: [node.id], edgeIds: [] },
    });
    if (indexWasCurrent && !this.transactionContext) this.syncSpatialNode(node.id);
    return structuredClone(node);
  }

  updateNode(id: string, patch: CanvasNodePatch, options: MutationOptions = {}): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Node patch must be an object.');
    for (const key of Object.keys(patch)) {
      if (!nodePatchKeys.has(key)) throw new TypeError(`Unsupported node patch field: ${key}.`);
    }
    if (patch.position) assertFinitePoint(patch.position, 'Node position');
    assertOptionalSize(patch.width, 'Node width');
    assertOptionalSize(patch.height, 'Node height');
    if (patch.type !== undefined && (typeof patch.type !== 'string' || !patch.type.trim())) {
      throw new TypeError('Node type must be a non-empty string.');
    }
    if (patch.parentId !== undefined && (typeof patch.parentId !== 'string' || !patch.parentId.trim())) {
      throw new TypeError('Node parentId must be a non-empty string.');
    }
    if (patch.locked !== undefined && typeof patch.locked !== 'boolean') throw new TypeError('Node locked must be boolean.');
    if (patch.data !== undefined && (!patch.data || typeof patch.data !== 'object' || Array.isArray(patch.data))) {
      throw new TypeError('Node data patch must be an object.');
    }
    if (patch.data !== undefined) assertJsonSerializable(patch.data, `node(${id}).data patch`);
    const affectsSpatialIndex = patch.position !== undefined || patch.width !== undefined || patch.height !== undefined;
    const affectsValidation = patch.type !== undefined || patch.data !== undefined;
    const indexWasCurrent = !this.spatialIndexDirty;
    this.mutate('更新节点', graph => {
      const node = graph.nodes.find(item => item.id === id);
      if (!node) throw new Error(`Node not found: ${id}`);
      const { position, data } = patch;
      if (patch.type !== undefined) node.type = patch.type;
      if (patch.width !== undefined) node.width = patch.width;
      if (patch.height !== undefined) node.height = patch.height;
      if (patch.parentId !== undefined) node.parentId = patch.parentId;
      if (patch.locked !== undefined) node.locked = patch.locked;
      if (position) node.position = { x: position.x, y: position.y };
      if (data) {
        const nextData = { ...node.data, ...structuredClone(data) };
        if (typeof nextData.title !== 'string') throw new TypeError('Node data title must be a string.');
        node.data = nextData;
      }
    }, {
      record: options.record,
      transient: options.transient,
      affectsSpatialIndex,
      affectsValidation,
    });
    if (affectsSpatialIndex && indexWasCurrent && !this.transactionContext) this.syncSpatialNode(id);
  }

  updateNodeData(id: string, data: Partial<CanvasNodeData>, options: MutationOptions = {}): void {
    this.updateNode(id, { data }, options);
  }

  removeNodes(ids: string[]): void {
    const idSet = new Set(ids);
    const nextSelection = {
      nodeIds: this.selection.nodeIds.filter(id => !idSet.has(id)),
      edgeIds: this.selection.edgeIds.filter(id => {
        const edge = this.graph.edges.find(item => item.id === id);
        return edge ? !idSet.has(edge.source) && !idSet.has(edge.target) : false;
      }),
    };
    const indexWasCurrent = !this.spatialIndexDirty;
    this.mutate('删除节点', graph => {
      graph.nodes = graph.nodes.filter(node => !idSet.has(node.id));
      graph.edges = graph.edges.filter(edge => !idSet.has(edge.source) && !idSet.has(edge.target));
    }, { selection: nextSelection });
    if (indexWasCurrent && !this.transactionContext) {
      for (const id of idSet) {
        this.spatialIndex.remove(id);
        this.spatialNodeMap.delete(id);
      }
      this.spatialIndexDirty = false;
    }
  }

  addEdge(input: EdgeInput): CanvasEdge {
    this.assertWritable('创建连线');
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Edge input must be an object.');
    }
    const allowedKeys = new Set(['id', 'source', 'sourcePort', 'target', 'targetPort', 'label', 'data']);
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string' || !allowedKeys.has(key)) {
        throw new TypeError(`Unknown edge property: ${String(key)}.`);
      }
    }
    for (const [key, value] of Object.entries({
      source: input.source,
      sourcePort: input.sourcePort,
      target: input.target,
      targetPort: input.targetPort,
    })) {
      if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Edge ${key} must be a non-empty string.`);
    }
    if (input.id !== undefined && (typeof input.id !== 'string' || !input.id.trim())) {
      throw new TypeError('Edge id must be a non-empty string.');
    }
    if (input.label !== undefined && typeof input.label !== 'string') {
      throw new TypeError('Edge label must be a string.');
    }
    if (input.data !== undefined) {
      if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) {
        throw new TypeError('Edge data must be an object.');
      }
      assertJsonSerializable(input.data, 'edge.data');
    }
    const edge: CanvasEdge = structuredClone({ ...input, id: input.id ?? crypto.randomUUID() });
    const candidate = cloneGraph(this.graph);
    candidate.edges.push(edge);
    const validation = validateGraph(candidate, this.registry);
    const blockingCodes = new Set([
      'DUPLICATE_EDGE_ID', 'SELF_CONNECTION', 'DUPLICATE_CONNECTION', 'PORT_TYPE_MISMATCH',
      'PORT_CARDINALITY', 'CYCLE_DETECTED', 'MISSING_SOURCE_NODE', 'MISSING_TARGET_NODE',
      'MISSING_SOURCE_PORT', 'MISSING_TARGET_PORT',
    ]);
    const blocking = validation.issues.filter(issue => (
      blockingCodes.has(issue.code) && (issue.edgeId === edge.id || issue.code === 'CYCLE_DETECTED')
    ));
    if (blocking.length) throw new GraphValidationError({ valid: false, issues: blocking });
    this.mutate('创建连线', graph => graph.edges.push(edge), { affectsSpatialIndex: false });
    return structuredClone(edge);
  }

  removeEdges(ids: string[]): void {
    const idSet = new Set(ids);
    this.mutate('删除连线', graph => {
      graph.edges = graph.edges.filter(edge => !idSet.has(edge.id));
    }, {
      selection: { ...this.selection, edgeIds: this.selection.edgeIds.filter(id => !idSet.has(id)) },
      affectsSpatialIndex: false,
    });
  }

  /** View navigation remains available in read-only mode. */
  setViewport(viewport: ViewportState, options: MutationOptions = { record: false }): void {
    assertFinitePoint(viewport, 'Viewport', new Set(['x', 'y', 'zoom']));
    if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
      throw new RangeError('Viewport zoom must be finite and greater than zero.');
    }
    this.mutate('更新视口', graph => {
      graph.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    }, {
      record: options.record === true,
      affectsSpatialIndex: false,
      affectsValidation: false,
      allowReadOnly: true,
    });
  }

  setSelection(selection: SelectionState): void {
    this.assertAlive();
    const normalized = this.normalizeSelection(selection);
    if (sameSelection(normalized, this.selection)) return;
    this.selection = normalized;
    if (this.transactionContext) {
      this.transactionContext.selectionTouched = true;
      return;
    }
    this.emitSelection();
    this.notify();
  }

  getSelection(): SelectionState {
    this.assertAlive();
    return structuredClone(this.selection);
  }

  copySelection(): ClipboardPayload {
    this.assertAlive();
    const nodeIds = new Set(this.selection.nodeIds);
    this.clipboard = {
      nodes: this.graph.nodes.filter(node => nodeIds.has(node.id)).map(node => structuredClone(node)),
      edges: this.graph.edges
        .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .map(edge => structuredClone(edge)),
    };
    return structuredClone(this.clipboard);
  }

  pasteClipboard(offset = { x: 32, y: 32 }): string[] {
    this.assertWritable('粘贴节点');
    assertFinitePoint(offset, 'Clipboard offset');
    if (!this.clipboard?.nodes.length) return [];
    const idMap = new Map<string, string>();
    const nodes = this.clipboard.nodes.map(node => {
      const id = crypto.randomUUID();
      idMap.set(node.id, id);
      return {
        ...structuredClone(node),
        id,
        position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      };
    });
    const edges = this.clipboard.edges.map(edge => ({
      ...structuredClone(edge),
      id: crypto.randomUUID(),
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
    }));
    const ids = nodes.map(node => node.id);
    this.mutate('粘贴节点', graph => {
      graph.nodes.push(...nodes);
      graph.edges.push(...edges);
    }, { selection: { nodeIds: ids, edgeIds: [] } });
    this.clipboard = { nodes, edges };
    return ids;
  }

  duplicateSelection(): string[] {
    this.copySelection();
    return this.pasteClipboard();
  }

  captureSnapshot(): GraphDocument {
    this.assertAlive();
    return cloneGraph(this.graph);
  }

  commitSnapshot(label: string, before: GraphDocument): void {
    this.assertAlive();
    if (typeof label !== 'string' || !label.trim()) throw new TypeError('Snapshot label must be a non-empty string.');
    const normalizedBefore = deserializeGraph(before, this.migrations);
    const after = cloneGraph(this.graph);
    if (sameGraph(normalizedBefore, after)) return;
    const selection = this.getSelection();
    this.commandHistory.push({
      label,
      undo: () => this.restoreState({ graph: normalizedBefore, selection }, `撤销${label}`),
      redo: () => this.restoreState({ graph: after, selection }, `重做${label}`),
    });
    // Transient updates intentionally emitted only render notifications. The
    // completed gesture becomes one observable/autosavable graph change here.
    this.validationCache = undefined;
    this.validationDeferredDirty = false;
    this.changed(label);
  }

  executeCommand<TResult>(command: CanvasCommand<TResult>, options?: MutationOptions): TResult;
  executeCommand<TResult>(
    label: string,
    execute: (engine: CanvasEngine) => TResult,
    options?: MutationOptions,
  ): TResult;
  executeCommand<TResult>(
    commandOrLabel: CanvasCommand<TResult> | string,
    executeOrOptions?: ((engine: CanvasEngine) => TResult) | MutationOptions,
    maybeOptions: MutationOptions = {},
  ): TResult {
    const command = typeof commandOrLabel === 'string'
      ? { label: commandOrLabel, execute: executeOrOptions as (engine: CanvasEngine) => TResult }
      : commandOrLabel;
    if (typeof command.execute !== 'function') throw new TypeError('Canvas command execute function is required.');
    const options = typeof commandOrLabel === 'string'
      ? maybeOptions
      : (executeOrOptions as MutationOptions | undefined) ?? {};
    return this.transaction(command.label, command.execute, options);
  }

  /**
   * Groups any number of synchronous engine commands into one atomic undo entry.
   * If the callback throws, graph and selection are rolled back without events.
   */
  transaction<TResult>(
    label: string,
    operation: (engine: CanvasEngine) => TResult,
    options: MutationOptions = {},
  ): TResult {
    this.assertWritable(label);
    if (this.transactionContext) return operation(this);

    const context: TransactionContext = {
      label,
      record: options.record !== false,
      before: this.captureState(),
      graphTouched: false,
      selectionTouched: false,
    };
    this.transactionContext = context;
    let result: TResult;
    try {
      result = operation(this);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new TypeError('CanvasEngine.transaction callbacks must be synchronous.');
      }
    } catch (cause) {
      this.graph = cloneGraph(context.before.graph);
      this.selection = structuredClone(context.before.selection);
      this.spatialIndexDirty = true;
      this.validationCache = undefined;
      this.validationDeferredDirty = false;
      throw cause;
    } finally {
      this.transactionContext = undefined;
    }

    const graphChanged = context.graphTouched && !sameGraph(context.before.graph, this.graph);
    const selectionChanged = !sameSelection(context.before.selection, this.selection);
    if (graphChanged && context.record) {
      const after = this.captureState();
      this.commandHistory.push({
        label,
        undo: () => this.restoreState(context.before, `撤销${label}`),
        redo: () => this.restoreState(after, `重做${label}`),
      });
    }
    if (graphChanged) {
      this.validationCache = undefined;
      this.validationDeferredDirty = false;
      this.changed(label);
    }
    if (selectionChanged) {
      this.emitSelection();
      if (!graphChanged) this.notify();
    }
    return result;
  }

  undo(): boolean {
    this.assertWritable('撤销');
    return this.commandHistory.undo();
  }

  redo(): boolean {
    this.assertWritable('重做');
    return this.commandHistory.redo();
  }

  validate(): ValidationResult {
    this.assertAlive();
    if (this.validationDeferredDirty) {
      this.validationCache = undefined;
      this.validationDeferredDirty = false;
    }
    const result = this.getValidationSnapshot();
    this.events.emit('validation:change', result);
    return result;
  }

  /** Cached validation result; callers receive an isolated copy. */
  getValidationSnapshot(): ValidationResult {
    this.assertAlive();
    if (!this.validationCache || this.validationRegistryRevision !== this.registry.revision) {
      this.validationCache = validateGraph(this.graph, this.registry);
      this.validationRegistryRevision = this.registry.revision;
    }
    return structuredClone(this.validationCache);
  }

  queryNodeIds(rect: CanvasRect): string[] {
    this.assertAlive();
    this.ensureSpatialIndex();
    return this.spatialIndex.query(rect);
  }

  queryNodes(rect: CanvasRect): CanvasNode[] {
    this.assertAlive();
    this.ensureSpatialIndex();
    return this.spatialIndex.query(rect).map(id => structuredClone(this.spatialNodeMap.get(id)!));
  }

  rebuildSpatialIndex(): void {
    this.assertAlive();
    this.spatialIndex.rebuild(this.graph.nodes);
    this.spatialNodeMap = new Map(this.graph.nodes.map(node => [node.id, node]));
    this.spatialIndexDirty = false;
  }

  async run(options: RuntimeOptions = {}): Promise<WorkflowRunResult> {
    return this.executeGraph(this.getGraph(), options);
  }

  /** Execute one node together with every transitive upstream dependency. */
  async runNode(nodeId: string, options: RuntimeOptions = {}): Promise<WorkflowRunResult> {
    this.assertAlive();
    const source = this.getGraph();
    if (!source.nodes.some(node => node.id === nodeId)) throw new Error(`Node not found: ${nodeId}`);
    const nodeIds = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
      const targetId = queue.shift()!;
      for (const edge of source.edges) {
        if (edge.target !== targetId || nodeIds.has(edge.source)) continue;
        nodeIds.add(edge.source);
        queue.push(edge.source);
      }
    }
    const graph: GraphDocument = {
      ...source,
      nodes: source.nodes.filter(node => nodeIds.has(node.id)),
      edges: source.edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
      metadata: { ...source.metadata, runScope: { kind: 'node', nodeId } },
    };
    return this.executeGraph(graph, {
      ...options,
      refreshNodeIds: [...new Set([...(options.refreshNodeIds ?? []), nodeId])],
    });
  }

  private async executeGraph(runGraph: GraphDocument, options: RuntimeOptions): Promise<WorkflowRunResult> {
    this.assertAlive();
    let validation: ValidationResult;
    try {
      validation = validateGraph(runGraph, this.registry);
      if (!validation.valid) throw new GraphValidationError(validation);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.events.emit('error', { error, source: 'run:validation' });
      throw error;
    }

    const controller = new AbortController();
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    const runNodeIds = new Set(runGraph.nodes.map(node => node.id));
    const activeRun: ActiveRun = { token: Symbol(runId), runId, controller, nodeIds: runNodeIds };
    const reportedStates = new Map<string, RuntimeNodeState>();
    this.activeRuns.set(runId, activeRun);
    this.events.emit('run:start', { runId, nodeIds: [...runNodeIds] });

    const finalizeResult = (result: WorkflowRunResult): WorkflowRunResult => {
      const completed = completeRuntimeResult(result, runNodeIds, reportedStates);
      if (this.activeRuns.get(runId)?.token === activeRun.token) {
        for (const state of Object.values(completed.nodeStates)) {
          this.applyRuntimeState(state);
          this.events.emit('run:node', state);
        }
      }
      return completed;
    };

    try {
      const runtimeResult = await this.runtime.execute(cloneGraph(runGraph), this.registry, {
        ...options,
        runId,
        signal: controller.signal,
        onNodeState: state => {
          if (this.activeRuns.get(runId)?.token !== activeRun.token) return;
          const normalizedState = normalizeRuntimeNodeState(state, runNodeIds);
          reportedStates.set(normalizedState.nodeId, normalizedState);
          this.applyRuntimeState(normalizedState);
          this.events.emit('run:node', normalizedState);
        },
      });
      if (controller.signal.aborted) {
        let cancelled: WorkflowRunResult = {
          runId,
          status: 'cancelled',
          nodeStates: {},
          outputs: {},
          startedAt,
          endedAt: Date.now(),
        };
        try {
          const normalized = normalizeRuntimeResult(runtimeResult, runId, runNodeIds);
          if (normalized.status === 'cancelled') cancelled = normalized;
        } catch {
          // Cancellation is authoritative even if a late adapter result is malformed.
        }
        cancelled = finalizeResult(cancelled);
        this.events.emit('run:end', cancelled);
        return cancelled;
      }
      const result = finalizeResult(normalizeRuntimeResult(runtimeResult, runId, runNodeIds));
      // run:end includes a runId, so consumers can account for every started run,
      // while stale node callbacks never overwrite the active run's UI state.
      if (result.status === 'error') {
        this.events.emit('error', {
          error: new Error(result.error ?? `Workflow run ${runId} failed.`),
          source: `runtime:${runId}`,
        });
      }
      this.events.emit('run:end', result);
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const cancelled = controller.signal.aborted || (error.name === 'AbortError');
      if (cancelled) {
        const result = finalizeResult({
          runId,
          status: 'cancelled',
          nodeStates: {},
          outputs: {},
          startedAt,
          endedAt: Date.now(),
        });
        this.events.emit('run:end', result);
        return result;
      }
      this.events.emit('error', { error, source: `runtime:${runId}` });
      const result = finalizeResult({
        runId,
        status: 'error',
        nodeStates: {},
        outputs: {},
        startedAt,
        endedAt: Date.now(),
        error: error.message,
      });
      this.events.emit('run:end', result);
      throw error;
    } finally {
      if (this.activeRuns.get(runId)?.token === activeRun.token) this.activeRuns.delete(runId);
    }
  }

  cancel(): void {
    for (const run of this.activeRuns.values()) run.controller.abort();
  }

  cancelNode(nodeId: string): void {
    for (const run of this.activeRuns.values()) {
      if (run.nodeIds.has(nodeId)) run.controller.abort();
    }
  }

  isRunning(): boolean {
    return this.activeRuns.size > 0;
  }

  isNodeRunning(nodeId: string): boolean {
    return [...this.activeRuns.values()].some(run => run.nodeIds.has(nodeId));
  }

  clearRuntimeCache(): void {
    this.assertAlive();
    this.runtime.clearCache?.();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancel();
    this.activeRuns.clear();
    this.listeners.clear();
    this.events.clear();
    this.destroyed = true;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new CanvasEngineDestroyedError();
  }

  private assertWritable(operation: string): void {
    this.assertAlive();
    if (this.readOnly) throw new CanvasReadOnlyError(operation);
  }

  private normalizeSelection(selection: SelectionState): SelectionState {
    const nodeIds = new Set(this.graph.nodes.map(node => node.id));
    const edgeIds = new Set(this.graph.edges.map(edge => edge.id));
    return {
      nodeIds: [...new Set(selection.nodeIds)].filter(id => nodeIds.has(id)).sort(),
      edgeIds: [...new Set(selection.edgeIds)].filter(id => edgeIds.has(id)).sort(),
    };
  }

  private captureState(): EngineSnapshot {
    return { graph: cloneGraph(this.graph), selection: this.getSelection() };
  }

  private applyRuntimeState(state: RuntimeNodeState): void {
    const node = this.graph.nodes.find(item => item.id === state.nodeId);
    if (!node) return;
    node.data = {
      ...node.data,
      status: state.status,
      progress: state.progress,
      runMessage: state.message,
      runError: state.error,
    };
    if (state.message === undefined) delete node.data.runMessage;
    if (state.error === undefined) delete node.data.runError;
    this.notify();
  }

  private mutate(
    label: string,
    mutation: (graph: GraphDocument) => void,
    options: InternalMutationOptions = {},
  ): void {
    this.assertAlive();
    if (!options.allowReadOnly) this.assertWritable(label);
    if (this.transactionContext) {
      mutation(this.graph);
      this.transactionContext.graphTouched = true;
      if (options.selection) {
        this.selection = this.normalizeSelection(options.selection);
        this.transactionContext.selectionTouched = true;
      }
      if (options.affectsSpatialIndex !== false) this.spatialIndexDirty = true;
      // During text/drag gestures React can request a render snapshot on every
      // key or pointer event. Keep the last validation visible and invalidate
      // once in commitSnapshot instead of rescanning a large graph per frame.
      if (options.affectsValidation !== false) {
        if (options.transient) this.validationDeferredDirty = true;
        else {
          this.validationCache = undefined;
          this.validationDeferredDirty = false;
        }
      }
      return;
    }

    const record = options.record !== false;
    if (!record) {
      // High-frequency paths (node dragging and viewport movement) deliberately
      // avoid before/after snapshots of the entire graph.
      mutation(this.graph);
      const selectionBefore = this.selection;
      if (options.selection) this.selection = this.normalizeSelection(options.selection);
      if (options.affectsSpatialIndex !== false) this.spatialIndexDirty = true;
      if (options.affectsValidation !== false) {
        if (options.transient) this.validationDeferredDirty = true;
        else {
          this.validationCache = undefined;
          this.validationDeferredDirty = false;
        }
      }
      if (options.transient) this.notify();
      else this.changed(label);
      if (!sameSelection(selectionBefore, this.selection)) this.emitSelection();
      return;
    }

    const before = this.captureState();
    let after: EngineSnapshot;
    let graphChanged: boolean;
    let selectionChanged: boolean;
    try {
      mutation(this.graph);
      if (options.selection) this.selection = this.normalizeSelection(options.selection);
      after = this.captureState();
      graphChanged = !sameGraph(before.graph, after.graph);
      selectionChanged = !sameSelection(before.selection, after.selection);
    } catch (cause) {
      this.graph = before.graph;
      this.selection = before.selection;
      this.spatialIndexDirty = true;
      this.validationCache = undefined;
      this.validationDeferredDirty = false;
      throw cause;
    }
    if (!graphChanged && !selectionChanged) return;
    if (graphChanged) {
      this.commandHistory.push({
        label,
        undo: () => this.restoreState(before, `撤销${label}`),
        redo: () => this.restoreState(after, `重做${label}`),
      });
      if (options.affectsSpatialIndex !== false) this.spatialIndexDirty = true;
      if (options.affectsValidation !== false) {
        this.validationCache = undefined;
        this.validationDeferredDirty = false;
      }
      this.changed(label);
    }
    if (selectionChanged) {
      this.emitSelection();
      if (!graphChanged) this.notify();
    }
  }

  private restoreState(snapshot: EngineSnapshot, label: string): void {
    const previousSelection = this.selection;
    this.graph = cloneGraph(snapshot.graph);
    this.selection = this.normalizeSelection(snapshot.selection);
    this.spatialIndexDirty = true;
    this.validationCache = undefined;
    this.validationDeferredDirty = false;
    this.changed(label);
    if (!sameSelection(previousSelection, this.selection)) this.emitSelection();
  }

  private changed(label: string): void {
    this.version += 1;
    if (this.events.hasListeners('graph:change')) {
      this.events.emit('graph:change', { graph: this.getGraph(), label });
    }
    if (this.events.hasListeners('validation:change')) {
      const result = this.getValidationSnapshot();
      this.events.emit('validation:change', result);
    }
    this.notify(false);
  }

  private emitSelection(): void {
    this.events.emit('selection:change', this.getSelection());
  }

  private notify(increment = true): void {
    if (increment) this.version += 1;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.events.emit('error', { error, source: 'subscriber' });
      }
    }
  }

  private ensureSpatialIndex(): void {
    if (this.spatialIndexDirty) this.rebuildSpatialIndex();
  }

  private syncSpatialNode(id: string): void {
    const node = this.graph.nodes.find(item => item.id === id);
    if (node) {
      this.spatialIndex.upsert(node);
      this.spatialNodeMap.set(id, node);
    } else {
      this.spatialIndex.remove(id);
      this.spatialNodeMap.delete(id);
    }
    this.spatialIndexDirty = false;
  }
}
