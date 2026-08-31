import { describe, expect, it } from 'vitest';

import { selectTextStyleRestoreRow } from '../src/text-style-runtime.js';

describe('edit_text_style restore lookup', () => {
  it('prefers the version-scoped artifact over the request fallback', () => {
    expect(
      selectTextStyleRestoreRow({ id: 'version' }, { id: 'fallback' }),
    ).toEqual({ id: 'version' });
  });

  it('falls back to the latest request artifact when version miss', () => {
    expect(selectTextStyleRestoreRow(undefined, { id: 'fallback' })).toEqual({
      id: 'fallback',
    });
  });

  it('returns undefined when neither artifact exists (fail-visible path)', () => {
    expect(selectTextStyleRestoreRow(undefined, undefined)).toBeUndefined();
  });
});

describe('restore_orbitype_preview contract for text style', () => {
  it('accepts restore_orbitype_preview as a workflow resume reason', async () => {
    const { workflowResumeSignalSchema } = await import('@binflow/contracts');
    const parsed = workflowResumeSignalSchema.parse({
      reason: 'restore_orbitype_preview',
      requestId: 'req_style_1',
      requestVersionId: 'ver_style_1',
      tenantId: 'ten_1',
    });
    expect(parsed.reason).toBe('restore_orbitype_preview');
  });
});
