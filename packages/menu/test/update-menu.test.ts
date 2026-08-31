import { describe, expect, it, vi } from 'vitest';

import {
  buildVersionedMenuPdfPath,
  discoverMenuCtas,
  publicUrlForMenuPdfPath,
  toggleMenuCtaSelection,
  verifyMenuPdfAccessible,
} from '../src/update-menu.js';

describe('update menu helpers', () => {
  it('discovers menu-semantics CTAs across page sections', () => {
    const pages = [
      {
        id: 'page-bistro',
        sections: [
          {
            ctaHref: '#speisekarte',
            ctaLabel: { de: 'Speisekarte entdecken' },
          },
          {
            ctaHref: '#reservieren',
            ctaLabel: { de: 'Tisch reservieren' },
          },
        ],
        slug: 'bistro',
        title: { de: 'Bistro' },
      },
    ];
    const discovered = discoverMenuCtas(pages, ['de']);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.key).toBe('bistro:0:ctaHref');
  });

  it('builds versioned public PDF paths and URLs', () => {
    const path = buildVersionedMenuPdfPath('019abc019abc019abc019abc019abc');
    expect(path).toMatch(/^public\/documents\/menu-\d{4}-\d{2}-\d{2}-/u);
    expect(
      publicUrlForMenuPdfPath('https://bistrozurlinde.ch', path),
    ).toBe(`https://bistrozurlinde.ch/${path.slice('public/'.length)}`);
  });

  it('toggles selected CTA keys', () => {
    expect(toggleMenuCtaSelection(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleMenuCtaSelection(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('selects all discovered CTA keys from an empty opt-in start', async () => {
    const { selectAllMenuCtaKeys } = await import('../src/update-menu.js');
    const keys = selectAllMenuCtaKeys([
      {
        currentHref: '/a.pdf',
        field: 'ctaHref',
        key: 'bistro:0:ctaHref',
        label: 'Speisekarte',
        pageId: '1',
        pageSlug: 'bistro',
        pageTitle: 'Bistro',
        sectionIndex: 0,
      },
      {
        currentHref: '/b.pdf',
        field: 'ctaHref',
        key: 'home:1:ctaHref',
        label: 'Menü',
        pageId: '2',
        pageSlug: 'home',
        pageTitle: 'Home',
        sectionIndex: 1,
      },
    ]);
    expect(keys).toEqual(['bistro:0:ctaHref', 'home:1:ctaHref']);
  });

  it('polls until the production menu PDF returns HTTP 200', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const pending = verifyMenuPdfAccessible('https://example.test/menu.pdf', {
        pollIntervalMs: 1_000,
        timeoutMs: 5_000,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await pending;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
