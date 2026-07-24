/**
 * A host runtime can throw this when execution needs settings that are not yet
 * available. Keeping this error generic lets a canvas mount and be edited
 * before Electron, browser, or server-specific credentials are configured.
 */
export class RuntimeConfigurationRequiredError extends Error {
  readonly code = 'CONFIGURATION_REQUIRED' as const;

  constructor(
    message = 'Workflow runtime configuration is required before execution.',
    readonly requirements: readonly string[] = [],
  ) {
    super(message);
    this.name = 'RuntimeConfigurationRequiredError';
  }
}

export interface RuntimeConfigurationRequiredLike {
  readonly code: 'CONFIGURATION_REQUIRED';
  readonly message: string;
  readonly requirements: readonly string[];
  readonly name?: string;
}

export function isRuntimeConfigurationRequiredError(
  error: unknown,
): error is RuntimeConfigurationRequiredLike {
  return error instanceof RuntimeConfigurationRequiredError
    || (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'CONFIGURATION_REQUIRED'
      && 'message' in error
      && typeof error.message === 'string'
      && 'requirements' in error
      && Array.isArray(error.requirements)
      && error.requirements.every(requirement => typeof requirement === 'string')
    );
}
