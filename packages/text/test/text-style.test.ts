import { describe, expect, it } from 'vitest';

import {
  adjustHexLightness,
  applyTextStylePatch,
  assertSingleFieldKind,
  fieldKindForTextField,
  wrapExcerptWithStyle,
} from '../src/text-style.js';
import type { TextEditCandidate } from '../src/discover-editable-copy.js';

const candidate = (field: string): TextEditCandidate => ({
  currentValue: 'Sample text',
  field,
  key: `page:0:${field}:en`,
  label: 'Sample text',
  locale: 'en',
  pageId: 'page',
  pageSlug: 'home',
  pageTitle: 'Home',
  sectionIndex: 0,
});

describe('text style helpers', () => {
  it('classifies heading, subtitle, and body fields', () => {
    expect(fieldKindForTextField('title')).toBe('heading');
    expect(fieldKindForTextField('subtitle')).toBe('subtitle');
    expect(fieldKindForTextField('content')).toBe('body');
  });

  it('rejects mixed field kinds', () => {
    expect(() =>
      assertSingleFieldKind([candidate('title'), candidate('content')]),
    ).toThrowError(/single text type/u);
  });

  it('adjusts hex colors by fifty percent', () => {
    expect(adjustHexLightness('#804020', 'darken50')).toBe('#402010');
    expect(adjustHexLightness('#804020', 'lighten50')).toBe('#C06030');
  });

  it('wraps only the excerpt with an inline style span', () => {
    const wrapped = wrapExcerptWithStyle('Hello Sample text world', 'Sample text', {
      fontWeight: 700,
    });
    expect(wrapped).toBe(
      'Hello <span class="font-bold" style="font-weight:700" data-binflow-style="1">Sample text</span> world',
    );
  });

  it('patches field text with surgical style wrap and style sibling', () => {
    const sections = [
      {
        content: { en: 'Welcome to the bistro today.' },
        contentStyle: { color: '#111111', lineHeight: 1.5 },
      },
    ];
    const patched = applyTextStylePatch(sections, {
      excerpt: 'bistro',
      field: 'content',
      locale: 'en',
      sectionIndex: 0,
      style: { color: '#FF5500', fontSizePx: 24, fontWeight: 700 },
    }) as Array<Record<string, unknown>>;
    expect(patched[0]?.content).toEqual({
      en: 'Welcome to the <span class="font-bold" style="font-weight:700;font-size:24px;color:#FF5500" data-binflow-style="1">bistro</span> today.',
    });
    expect(patched[0]?.contentStyle).toEqual({
      color: '#FF5500',
      fontSize: 24,
      fontWeight: 700,
      lineHeight: 1.5,
    });
    expect(sections[0]?.content).toEqual({ en: 'Welcome to the bistro today.' });
  });
});
