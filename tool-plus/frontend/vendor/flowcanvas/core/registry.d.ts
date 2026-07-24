import type { CanvasNodeData, NodeDefinition } from './types.js';
export declare class NodeRegistry {
    private readonly definitions;
    private _revision;
    get revision(): number;
    register<TData extends CanvasNodeData>(definition: NodeDefinition<TData>): () => void;
    replace<TData extends CanvasNodeData>(definition: NodeDefinition<TData>): void;
    unregister(type: string): boolean;
    get(type: string): NodeDefinition | undefined;
    require(type: string): NodeDefinition;
    list(): NodeDefinition[];
    has(type: string): boolean;
}
