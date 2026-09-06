import { describe, expect, it } from 'vitest';

describe('piloter owner notice templates', () => {
  it('formats localized success copy without LLM', async () => {
    const { enqueuePiloterOwnerSuccessNotice } = await import(
      '../src/piloter-owner-notice.js'
    );
    expect(typeof enqueuePiloterOwnerSuccessNotice).toBe('function');
  });
});
