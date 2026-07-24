import { cloneGraph } from './core/serialization';
import type { GraphDocument } from './core/types';

export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface AutosaveStatus {
  state: AutosaveState;
  revision: number;
  savedRevision: number;
  error?: string;
}

/** Raised by an explicit flush when the requested revision was not persisted. */
export class AutosaveFlushError extends Error {
  readonly code = 'AUTOSAVE_FLUSH_FAILED';

  constructor(readonly status: AutosaveStatus) {
    super(
      status.error
        ? `Autosave flush failed: ${status.error}`
        : `Autosave flush did not persist revision ${status.revision}.`,
    );
    this.name = 'AutosaveFlushError';
  }
}

export interface AutosaveContext {
  revision: number;
  signal: AbortSignal;
}

export type AutosaveHandler = (
  graph: GraphDocument,
  context: AutosaveContext,
) => void | Promise<void>;

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
export class AutosaveController {
  private timer?: ReturnType<typeof setTimeout>;
  private queuedGraph?: GraphDocument;
  private queuedRevision = 0;
  private revision = 0;
  private savedRevision = 0;
  private currentState: AutosaveState = 'idle';
  private lastError?: string;
  private chain: Promise<void> = Promise.resolve();
  private destroyed = false;
  private readonly abortController = new AbortController();

  constructor(private readonly options: AutosaveControllerOptions) {}

  schedule(graph: GraphDocument): number {
    if (this.destroyed) return this.revision;
    this.revision += 1;
    this.queuedRevision = this.revision;
    this.queuedGraph = cloneGraph(graph);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.enqueuePending(), Math.max(0, this.options.delay ?? 500));
    this.emit('pending');
    return this.revision;
  }

  async flush(): Promise<AutosaveStatus> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const targetRevision = this.revision;
    this.enqueuePending();
    const pending = this.chain;
    await pending;

    const status = this.getStatus();
    if (status.savedRevision < targetRevision) throw new AutosaveFlushError(status);
    return status;
  }

  getStatus(): AutosaveStatus {
    return {
      state: this.currentState,
      revision: this.revision,
      savedRevision: this.savedRevision,
      error: this.lastError,
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queuedGraph = undefined;
    this.abortController.abort();
  }

  private enqueuePending(): void {
    if (this.destroyed || !this.queuedGraph) return;
    const graph = this.queuedGraph;
    const revision = this.queuedRevision;
    this.queuedGraph = undefined;
    this.timer = undefined;

    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        if (this.destroyed) return;
        this.emit('saving', revision);
        try {
          await this.options.save(graph, { revision, signal: this.abortController.signal });
          if (this.destroyed || this.abortController.signal.aborted) return;
          this.savedRevision = Math.max(this.savedRevision, revision);
          if (this.queuedGraph || this.savedRevision < this.revision) this.emit('pending');
          else this.emit('saved', revision);
        } catch (cause) {
          if (this.destroyed && this.abortController.signal.aborted) return;
          const error = cause instanceof Error ? cause : new Error(String(cause));
          // Keep the failed snapshot available for an explicit retry. A newer
          // queued revision supersedes it and must never be overwritten.
          if (this.revision === revision && (!this.queuedGraph || this.queuedRevision <= revision)) {
            this.queuedGraph = graph;
            this.queuedRevision = revision;
          }
          this.emit('error', revision, error);
          this.reportError(error);
        }
      });
  }

  private emit(state: AutosaveState, revision = this.revision, error?: Error): void {
    this.currentState = state;
    this.lastError = error?.message;
    const status = {
      state,
      revision,
      savedRevision: this.savedRevision,
      error: error?.message,
    };
    try {
      this.options.onStatus?.(status);
    } catch (cause) {
      this.reportError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  private reportError(error: Error): void {
    try {
      this.options.onError?.(error);
    } catch {
      // Host observers are diagnostic only and must never break persistence.
    }
  }
}
