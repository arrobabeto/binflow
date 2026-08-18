import { describe, expect, it } from 'vitest';

import { DomainError } from '@binflow/domain';

import { normalizeApiError } from '../src/errors.js';

describe('API error normalization', () => {
  it('maps stable domain categories without provider payloads', () => {
    expect(
      normalizeApiError(
        new DomainError('conflict_error', 'Refresh and retry.', {
          code: 'stale_resource',
        }),
        'correlation-1',
      ),
    ).toEqual({
      body: {
        error: {
          category: 'conflict_error',
          code: 'stale_resource',
          correlationId: 'correlation-1',
          message: 'Refresh and retry.',
        },
      },
      statusCode: 409,
    });
  });

  it('does not expose unexpected native error messages', () => {
    expect(
      normalizeApiError(
        new Error('Authorization: Bearer provider-secret'),
        'correlation-2',
      ),
    ).toEqual({
      body: {
        error: {
          category: 'internal_error',
          code: 'internal_error',
          correlationId: 'correlation-2',
          message: 'The request could not be completed.',
        },
      },
      statusCode: 500,
    });
  });
});
