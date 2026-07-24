import type { NodeRegistry } from '../core/registry.js';
import type { GraphDocument, RuntimeNodeState, RuntimeOptions, WorkflowRunResult } from '../core/types.js';
export { RuntimeConfigurationRequiredError, isRuntimeConfigurationRequiredError } from './errors.js';
export interface RuntimeExecutionOptions extends RuntimeOptions {
    runId: string;
    signal: AbortSignal;
    onNodeState?: (state: RuntimeNodeState) => void;
}
export interface WorkflowRuntime {
    execute(graph: GraphDocument, registry: NodeRegistry, options: RuntimeExecutionOptions): Promise<WorkflowRunResult>;
    clearCache?(): void;
}
export interface LocalWorkflowRuntimeOptions {
    /** Maximum LRU entries. Set to zero to disable storage. */
    maxCacheEntries?: number;
    /** Hard cap for host-provided node retryCount values. Defaults to 3. */
    maxRetries?: number;
}
export declare class LocalWorkflowRuntime implements WorkflowRuntime {
    private readonly cache;
    private readonly maxCacheEntries;
    private readonly maxRetries;
    constructor(options?: LocalWorkflowRuntimeOptions);
    get cacheSize(): number;
    clearCache(): void;
    execute(graph: GraphDocument, registry: NodeRegistry, options: RuntimeExecutionOptions): Promise<WorkflowRunResult>;
    private readCache;
    private writeCache;
}
