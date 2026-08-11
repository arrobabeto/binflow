export type TenantScope = Readonly<{
  tenantId: string;
  projectId?: string;
}>;

export const errorCategories = [
  'validation_error',
  'authentication_error',
  'authorization_error',
  'policy_denied',
  'conflict_error',
  'budget_exceeded',
  'credential_unavailable',
  'provider_retryable',
  'provider_final',
  'internal_error',
] as const;

export type ErrorCategory = (typeof errorCategories)[number];

export class DomainError extends Error {
  public constructor(
    public readonly category: ErrorCategory,
    message: string,
    public readonly metadata: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
