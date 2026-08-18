import { describe, expect, it } from 'vitest';

import {
  adminOperationReferenceSchema,
  apiErrorResponseSchema,
  cursorQuerySchema,
  idempotencyKeySchema,
} from '../src/index.js';

describe('control-plane contracts', () => {
  it('applies bounded cursor defaults', () => {
    expect(cursorQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(cursorQuerySchema.parse({ limit: '100' })).toEqual({ limit: 100 });
    expect(() => cursorQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => cursorQuerySchema.parse({ extra: true })).toThrow();
  });

  it('accepts only printable, bounded idempotency keys', () => {
    expect(idempotencyKeySchema.parse('request-0123456789')).toBe(
      'request-0123456789',
    );
    expect(() => idempotencyKeySchema.parse('short')).toThrow();
    expect(() =>
      idempotencyKeySchema.parse('request key with spaces'),
    ).toThrow();
    expect(() =>
      idempotencyKeySchema.parse(`request-${'x'.repeat(201)}`),
    ).toThrow();
  });

  it('rejects provider-native or extra error fields', () => {
    const valid = {
      error: {
        category: 'conflict_error',
        code: 'stale_resource',
        correlationId: 'correlation-1',
        message: 'The resource changed. Refresh and retry.',
      },
    };
    expect(apiErrorResponseSchema.parse(valid)).toEqual(valid);
    expect(() =>
      apiErrorResponseSchema.parse({
        ...valid,
        error: { ...valid.error, providerBody: { token: 'secret' } },
      }),
    ).toThrow();
  });

  it('returns relative status URLs for accepted operations', () => {
    const reference = {
      operationId: 'operation-1',
      status: 'pending',
      statusUrl: '/api/v1/operations/operation-1',
    };
    expect(adminOperationReferenceSchema.parse(reference)).toEqual(reference);
    expect(() =>
      adminOperationReferenceSchema.parse({
        ...reference,
        statusUrl: 'https://provider.example/operation-1',
      }),
    ).toThrow();
  });
});
