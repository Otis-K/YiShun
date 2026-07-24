import type { EngineEventMap, EngineEventName } from './types.js';
type Listener<K extends EngineEventName> = (payload: EngineEventMap[K]) => void;
export declare class TypedEventBus {
    private readonly listeners;
    on<K extends EngineEventName>(event: K, listener: Listener<K>): () => void;
    off<K extends EngineEventName>(event: K, listener: Listener<K>): void;
    hasListeners(event: EngineEventName): boolean;
    emit<K extends EngineEventName>(event: K, payload: EngineEventMap[K]): void;
    clear(): void;
    private clonePayload;
}
export {};
