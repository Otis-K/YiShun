import { TypedEventBus } from './events.js';
import { NodeRegistry } from './registry.js';
import { type GraphMigrationRegistry } from './serialization.js';
import type { CanvasEdge, CanvasNode, CanvasNodeData, CanvasRect, ClipboardPayload, EngineEventMap, EngineEventName, GraphDocument, NodeDefinition, RuntimeOptions, ReadonlyGraphDocument, SelectionState, ValidationResult, ViewportState, WorkflowRunResult } from './types.js';
import type { WorkflowRuntime } from '../runtime/local-runtime.js';
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
export type EdgeInput = Omit<CanvasEdge, 'id'> & {
    id?: string;
};
export declare class CanvasReadOnlyError extends Error {
    readonly operation: string;
    readonly code: 'CANVAS_READ_ONLY';
    constructor(operation: string);
}
export declare class CanvasEngineDestroyedError extends Error {
    readonly code: 'CANVAS_ENGINE_DESTROYED';
    constructor();
}
export declare class CanvasEngine {
    readonly registry: NodeRegistry;
    readonly events: TypedEventBus;
    readonly history: CommandHistoryView;
    private graph;
    private readonly commandHistory;
    private selection;
    private clipboard?;
    private readonly runtime;
    private readonly migrations?;
    private readonly activeRuns;
    private readonly listeners;
    private readonly spatialIndex;
    private spatialNodeMap;
    private spatialIndexDirty;
    private transactionContext?;
    private validationCache?;
    private validationRegistryRevision;
    private validationDeferredDirty;
    private readonlyViewSource?;
    private readonlyView?;
    private readOnly;
    private version;
    private destroyed;
    constructor(options?: CanvasEngineOptions);
    subscribe: (listener: () => void) => (() => void);
    getVersion: () => number;
    on<K extends EngineEventName>(event: K, listener: (payload: EngineEventMap[K]) => void): () => void;
    setReadOnly(readOnly: boolean): void;
    isReadOnly(): boolean;
    getGraph(): GraphDocument;
    /** Zero-copy graph view for render hot paths. The SDK never grants mutable typing for it. */
    getGraphSnapshot(): ReadonlyGraphDocument;
    exportGraph(space?: number): string;
    importGraph(input: string | GraphDocument): void;
    registerNodeType<TData extends CanvasNodeData>(definition: NodeDefinition<TData>): () => void;
    addNode(type: string, position: {
        x: number;
        y: number;
    }, data?: Partial<CanvasNodeData>): CanvasNode;
    updateNode(id: string, patch: CanvasNodePatch, options?: MutationOptions): void;
    updateNodeData(id: string, data: Partial<CanvasNodeData>, options?: MutationOptions): void;
    removeNodes(ids: string[]): void;
    addEdge(input: EdgeInput): CanvasEdge;
    removeEdges(ids: string[]): void;
    /** View navigation remains available in read-only mode. */
    setViewport(viewport: ViewportState, options?: MutationOptions): void;
    setSelection(selection: SelectionState): void;
    getSelection(): SelectionState;
    copySelection(): ClipboardPayload;
    pasteClipboard(offset?: {
        x: number;
        y: number;
    }): string[];
    duplicateSelection(): string[];
    captureSnapshot(): GraphDocument;
    commitSnapshot(label: string, before: GraphDocument): void;
    executeCommand<TResult>(command: CanvasCommand<TResult>, options?: MutationOptions): TResult;
    executeCommand<TResult>(label: string, execute: (engine: CanvasEngine) => TResult, options?: MutationOptions): TResult;
    /**
     * Groups any number of synchronous engine commands into one atomic undo entry.
     * If the callback throws, graph and selection are rolled back without events.
     */
    transaction<TResult>(label: string, operation: (engine: CanvasEngine) => TResult, options?: MutationOptions): TResult;
    undo(): boolean;
    redo(): boolean;
    validate(): ValidationResult;
    /** Cached validation result; callers receive an isolated copy. */
    getValidationSnapshot(): ValidationResult;
    queryNodeIds(rect: CanvasRect): string[];
    queryNodes(rect: CanvasRect): CanvasNode[];
    rebuildSpatialIndex(): void;
    run(options?: RuntimeOptions): Promise<WorkflowRunResult>;
    /** Execute one node together with every transitive upstream dependency. */
    runNode(nodeId: string, options?: RuntimeOptions): Promise<WorkflowRunResult>;
    private executeGraph;
    cancel(): void;
    cancelNode(nodeId: string): void;
    isRunning(): boolean;
    isNodeRunning(nodeId: string): boolean;
    clearRuntimeCache(): void;
    destroy(): void;
    private assertAlive;
    private assertWritable;
    private normalizeSelection;
    private captureState;
    private applyRuntimeState;
    private mutate;
    private restoreState;
    private changed;
    private emitSelection;
    private notify;
    private ensureSpatialIndex;
    private syncSpatialNode;
}
