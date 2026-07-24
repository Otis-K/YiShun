import type { GraphDocument, ValidationResult } from './types.js';
import type { NodeRegistry } from './registry.js';
export declare function validateGraph(graph: GraphDocument, registry: NodeRegistry): ValidationResult;
export declare class GraphValidationError extends Error {
    readonly result: ValidationResult;
    constructor(result: ValidationResult);
}
