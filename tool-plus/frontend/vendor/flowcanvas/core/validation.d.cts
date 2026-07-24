import type { GraphDocument, ValidationResult } from './types.cjs';
import type { NodeRegistry } from './registry.cjs';
export declare function validateGraph(graph: GraphDocument, registry: NodeRegistry): ValidationResult;
export declare class GraphValidationError extends Error {
    readonly result: ValidationResult;
    constructor(result: ValidationResult);
}
