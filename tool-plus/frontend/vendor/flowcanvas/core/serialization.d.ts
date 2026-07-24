import type { GraphDocument } from './types.js';
export type RawGraphDocument = Record<string, unknown>;
export type GraphMigration = (document: RawGraphDocument) => RawGraphDocument;
export interface RegisterMigrationOptions {
    replace?: boolean;
}
/** A strict, adjacent-version migration chain. */
export declare class GraphMigrationRegistry {
    readonly targetVersion: number;
    private readonly migrations;
    constructor(targetVersion: number);
    register(fromVersion: number, toVersion: number, migrate: GraphMigration, options?: RegisterMigrationOptions): () => void;
    migrate(document: RawGraphDocument): RawGraphDocument;
}
/** Validates values stored in a graph so export can never silently lose data. */
export declare function assertJsonSerializable(value: unknown, path?: string): void;
/** Registers a migration used by deserializeGraph. Chains must be 0->1->2, without gaps. */
export declare function registerGraphMigration(fromVersion: number, toVersion: number, migrate: GraphMigration, options?: RegisterMigrationOptions): () => void;
export declare function cloneGraph(graph: GraphDocument): GraphDocument;
export declare function createEmptyGraph(name?: string): GraphDocument;
export declare function serializeGraph(graph: GraphDocument, space?: number): string;
export declare function deserializeGraph(input: string | GraphDocument | RawGraphDocument, migrations?: GraphMigrationRegistry): GraphDocument;
