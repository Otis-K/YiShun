/**
 * A host runtime can throw this when execution needs settings that are not yet
 * available. Keeping this error generic lets a canvas mount and be edited
 * before Electron, browser, or server-specific credentials are configured.
 */
export declare class RuntimeConfigurationRequiredError extends Error {
    readonly requirements: readonly string[];
    readonly code: 'CONFIGURATION_REQUIRED';
    constructor(message?: string, requirements?: readonly string[]);
}
export interface RuntimeConfigurationRequiredLike {
    readonly code: 'CONFIGURATION_REQUIRED';
    readonly message: string;
    readonly requirements: readonly string[];
    readonly name?: string;
}
export declare function isRuntimeConfigurationRequiredError(error: unknown): error is RuntimeConfigurationRequiredLike;
