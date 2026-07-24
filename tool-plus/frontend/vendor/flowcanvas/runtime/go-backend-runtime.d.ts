import type { GraphDocument, WorkflowRunResult } from '../core/types.js';
import type { NodeRegistry } from '../core/registry.js';
import type { RuntimeExecutionOptions, WorkflowRuntime } from './local-runtime.js';
export interface GoBackendWorkflowRuntimeOptions {
    /** Base URL of the Go backend transport, for example http://127.0.0.1:8787/api/flow. */
    baseURL: string;
    /** Defaults to globalThis.fetch. */
    fetch?: typeof fetch;
    /** Also call /validate before /run. Defaults to true so backend validation is real. */
    validateBeforeRun?: boolean;
    /** Milliseconds before plain HTTP requests time out. SSE listens until terminal event or AbortSignal. */
    requestTimeoutMs?: number;
}
interface BackendValidationResult {
    valid: boolean;
    issues: Array<{
        code: string;
        severity: 'error' | 'warning';
        message: string;
        nodeId?: string;
        edgeId?: string;
        portId?: string;
        details?: Record<string, unknown>;
    }>;
}
export declare class GoBackendWorkflowRuntime implements WorkflowRuntime {
    private readonly baseURL;
    private readonly fetchImpl;
    private readonly validateBeforeRun;
    private readonly requestTimeoutMs;
    constructor(options: GoBackendWorkflowRuntimeOptions);
    validate(graph: GraphDocument): Promise<BackendValidationResult>;
    execute(graph: GraphDocument, _registry: NodeRegistry, options: RuntimeExecutionOptions): Promise<WorkflowRunResult>;
    cancel(runId: string): Promise<void>;
    private consumeEvents;
    private consumeSSEBuffer;
    private applyEvent;
    private normalizeRunResult;
    private requestJSON;
    private responseError;
    private resolve;
}
export {};
