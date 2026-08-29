import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DomainError } from '@binflow/domain';

import { mapOpenAIGenerationError } from '../src/index.js';

describe('mapOpenAIGenerationError', () => {
  it('maps Structured Outputs optional-field schema errors to provider_final', () => {
    const mapped = mapOpenAIGenerationError(
      new Error(
        'Schema field at `properties/operations/items/anyOf/0/properties/seoTitulo` uses `.optional()` without `.nullable()` which is not supported by the API. See: https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required',
      ),
    );
    expect(mapped.category).toBe('provider_final');
    expect(mapped.message).toContain('structured output schema');
    expect(mapped.metadata.detail).toContain('.optional()');
  });

  it('maps Zod schema failures to provider_final', () => {
    const schema = z.object({ magnitude: z.literal('body_patch') });
    let zodError: z.ZodError;
    try {
      schema.parse({ magnitude: 'title_locales' });
      throw new Error('expected parse to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      zodError = error as z.ZodError;
    }
    const mapped = mapOpenAIGenerationError(zodError!);
    expect(mapped).toBeInstanceOf(DomainError);
    expect(mapped.category).toBe('provider_final');
    expect(mapped.message).toContain('schema validation');
    expect(mapped.metadata.detail).toBeTruthy();
  });

  it('keeps transport outages retryable', () => {
    expect(
      mapOpenAIGenerationError({ status: 503, message: 'unavailable' }).category,
    ).toBe('provider_retryable');
    expect(
      mapOpenAIGenerationError({ status: 429, message: 'rate limit' }).category,
    ).toBe('provider_retryable');
  });

  it('maps length finish reasons to provider_final', () => {
    expect(
      mapOpenAIGenerationError({
        name: 'LengthFinishReasonError',
        message: 'too long',
      }).category,
    ).toBe('provider_final');
  });
});
