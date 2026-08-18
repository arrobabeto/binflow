import {
  apiErrorResponseSchema,
  type ApiErrorResponse,
} from '@binflow/contracts';
import { DomainError, type ErrorCategory } from '@binflow/domain';

const statusByCategory: Readonly<Record<ErrorCategory, number>> = {
  authentication_error: 401,
  authorization_error: 403,
  budget_exceeded: 422,
  conflict_error: 409,
  credential_unavailable: 503,
  internal_error: 500,
  policy_denied: 403,
  provider_final: 502,
  provider_retryable: 503,
  validation_error: 400,
};

export const normalizeApiError = (
  error: unknown,
  correlationId: string,
): Readonly<{ body: ApiErrorResponse; statusCode: number }> => {
  const normalized =
    error instanceof DomainError
      ? error
      : new DomainError(
          'internal_error',
          'The request could not be completed.',
        );
  const code = normalized.metadata.code ?? normalized.category;
  const body = apiErrorResponseSchema.parse({
    error: {
      category: normalized.category,
      code,
      correlationId,
      message:
        normalized.category === 'internal_error'
          ? 'The request could not be completed.'
          : normalized.message,
    },
  });
  return { body, statusCode: statusByCategory[normalized.category] };
};
