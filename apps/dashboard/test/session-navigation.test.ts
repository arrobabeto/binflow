import { describe, expect, it, vi } from 'vitest';

import {
  authenticatedDestination,
  revalidateAndReplaceAuthenticatedDocument,
} from '../app/lib/session-navigation';

describe('authenticated session navigation', () => {
  it('revalidates the server session before replacing the document', async () => {
    const getSession = vi.fn(async () => ({
      data: { user: { twoFactorEnabled: true } },
      error: null,
    }));
    const replace = vi.fn();

    await revalidateAndReplaceAuthenticatedDocument(
      { getSession },
      '/operations?tab=telegram',
      replace,
    );

    expect(getSession).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    });
    expect(replace).toHaveBeenCalledWith('/operations?tab=telegram');
  });

  it('does not navigate when the refreshed session is missing assurance', async () => {
    const replace = vi.fn();

    await expect(
      revalidateAndReplaceAuthenticatedDocument(
        {
          getSession: vi.fn(async () => ({ data: null, error: null })),
        },
        '/',
        replace,
      ),
    ).rejects.toThrow('could not be revalidated');
    expect(replace).not.toHaveBeenCalled();
  });

  it('rejects external redirect candidates', () => {
    expect(authenticatedDestination('https://example.com')).toBe('/');
    expect(authenticatedDestination('//example.com')).toBe('/');
    expect(authenticatedDestination(['/operations'])).toBe('/');
  });
});
