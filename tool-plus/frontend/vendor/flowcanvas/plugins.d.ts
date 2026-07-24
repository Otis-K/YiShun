import type { CanvasEngine } from './core/engine.js';
import type { FlowCanvasSDK } from './sdk.js';
export interface FlowCanvasPluginContext {
    sdk: FlowCanvasSDK;
    engine: CanvasEngine;
}
export type PluginCleanup = void | (() => void) | {
    dispose: () => void;
};
export interface FlowCanvasPlugin {
    /** Stable identifier used to prevent installing a plugin twice. */
    id: string;
    version?: string;
    install: (context: FlowCanvasPluginContext) => PluginCleanup;
}
export declare class PluginHost {
    private readonly installed;
    use(plugin: FlowCanvasPlugin, context: FlowCanvasPluginContext): () => void;
    unuse(id: string): boolean;
    has(id: string): boolean;
    list(): FlowCanvasPlugin[];
    destroy(): void;
}
