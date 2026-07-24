import type { NodeDefinition } from './core/types.js';
export declare const builtinNodeDefinitions: NodeDefinition[];
export declare function registerBuiltinNodes(register: (definition: NodeDefinition) => unknown): void;
