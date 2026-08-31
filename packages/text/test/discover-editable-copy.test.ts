import { describe, expect, it } from 'vitest';

import {
  applySurgicalTextFieldPatch,
  applyTextFieldPatch,
  discoverEditableCopy,
  searchEditableCopy,
} from '../src/discover-editable-copy.js';

const pages = [
  {
    id: 'page-bistro',
    sections: [
      {
        content: { de: 'Willkommen im Bistro Zurlinde.' },
        ctaHref: '#menu',
        ctaLabel: { de: 'Speisekarte' },
        title: { de: 'Unser Bistro' },
      },
    ],
    slug: 'bistro',
    title: { de: 'Bistro' },
  },
] as const;

describe('discoverEditableCopy', () => {
  it('includes paragraph and section title fields but not CTA labels', () => {
    const candidates = discoverEditableCopy(pages, ['de'], 'de');
    const fields = candidates.map((candidate) => candidate.field);
    expect(fields).toContain('content');
    expect(fields).toContain('title');
    expect(fields).not.toContain('ctaLabel');
    expect(fields).not.toContain('ctaHref');
  });

  it('finds targets by substring', () => {
    const matches = searchEditableCopy(
      pages,
      ['de'],
      'de',
      'Willkommen',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.currentValue).toContain('Willkommen');
  });

  it('applies surgical excerpt replacement inside the field', () => {
    const patched = applySurgicalTextFieldPatch(pages[0]!.sections, {
      excerpt: 'Willkommen',
      field: 'content',
      locale: 'de',
      replacement: 'Hallo',
      sectionIndex: 0,
    }) as Array<Record<string, unknown>>;
    expect((patched[0]?.content as { de: string }).de).toBe(
      'Hallo im Bistro Zurlinde.',
    );
  });

  it('applies literal locale replacement', () => {
    const patched = applyTextFieldPatch(pages[0]!.sections, {
      field: 'content',
      locale: 'de',
      newValue: 'Neuer Absatz.',
      sectionIndex: 0,
    }) as Array<Record<string, unknown>>;
    expect((patched[0]?.content as { de: string }).de).toBe('Neuer Absatz.');
  });
});
