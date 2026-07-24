import type { GraphDocument } from './core/types.js';
export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
export interface AutosaveStatus {
    state: AutosaveState;
    revision: number;
    savedRevision: number;
    error?: string;
}
/** Raised by an explicit flush when the requested revision was not persisted. */
export declare class AutosaveFlushError extends Error {
    readonly status: AutosaveStatus;
    readonly code = "AUTOSAVE_FLUSH_FAILED";
    constructor(status: AutosaveStatus);
}
export interface AutosaveContext {
    revision: number;
    signal: AbortSignal;
}
export type AutosaveHandler = (graph: GraphDocument, context: AutosaveContext) => void | Promise<void>;
export interface AutosaveControllerOptions {
    save: AutosaveHandler;
    delay?: number;
    onStatus?: (status: AutosaveStatus) => void;
    onError?: (error: Error) => void;
}
/**
 * Serialises saves so an older asynchronous write can never finish after a
 * newer write. Changes that arrive while a save is running are coalesced into
 * the next revision.
 */
export declare class AutosaveController {
    private readonly options;
    private timer?;
    private queuedGraph?;
    private queuedRevision;
    private revision;
    private savedRevision;
    private currentState;
    private lastError?;
    private chain;
    private destroyed;
    private readonly abortController;
    constructor(options: AutosaveControllerOptions);
    schedule(graph: GraphDocument): number;
    flush(): Promise<AutosaveStatus>;
    getStatus(): AutosaveStatus;
    destroy(): void;
    private enqueuePending;
    private emit;
    private reportError;
}
