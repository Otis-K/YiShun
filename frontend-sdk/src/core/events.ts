import type { EngineEventMap, EngineEventName } from './types';

type Listener<K extends EngineEventName> = (payload: EngineEventMap[K]) => void;

export class TypedEventBus {
  private readonly listeners = new Map<EngineEventName, Set<(payload: unknown) => void>>();

  on<K extends EngineEventName>(event: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (payload: unknown) => void);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  off<K extends EngineEventName>(event: K, listener: Listener<K>): void {
    this.listeners.get(event)?.delete(listener as (payload: unknown) => void);
  }

  hasListeners(event: EngineEventName): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  emit<K extends EngineEventName>(event: K, payload: EngineEventMap[K]): void {
    // A host callback must never prevent other SDK listeners, graph mutations,
    // or workflow cleanup from completing. Listener failures are forwarded to
    // the regular error channel; failures in that channel are intentionally
    // swallowed to avoid an infinite error-reporting loop.
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        listener(this.clonePayload(event, payload));
      } catch (cause) {
        if (event !== 'error') {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          this.emit('error', { error, source: `event-listener:${event}` });
        }
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  private clonePayload<K extends EngineEventName>(event: K, payload: EngineEventMap[K]): EngineEventMap[K] {
    if (event !== 'error') return structuredClone(payload);
    const errorPayload = payload as EngineEventMap['error'];
    const source = errorPayload.error;
    const error = Object.assign(new Error(source.message), structuredClone({ ...source }));
    error.name = source.name;
    error.stack = source.stack;
    return { error, source: errorPayload.source } as EngineEventMap[K];
  }
}
