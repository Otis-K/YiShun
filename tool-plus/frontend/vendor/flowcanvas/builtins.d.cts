import type { NodeDefinition } from './core/types.cjs';
export declare const builtinNodeDefinitions: NodeDefinition[];
export declare function registerBuiltinNodes(register: (definition: NodeDefinition) => unknown): void;
