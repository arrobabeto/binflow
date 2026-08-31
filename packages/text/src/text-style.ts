import type { SupportedLocale, TextStylePatch } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';

import {
  applyTextFieldPatch,
  resolveMatchedExcerpt,
  type TextEditCandidate,
} from './discover-editable-copy.js';

export type TextStyleFieldKind = 'heading' | 'subtitle' | 'body';

export type TextStyleBaseline = Readonly<{
  color: string;
  fontSizePx: number;
  fontWeight: 400 | 600 | 700;
}>;

const DEFAULT_BASELINE: TextStyleBaseline = Object.freeze({
  color: '#111111',
  fontSizePx: 16,
  fontWeight: 400,
});

export const fieldKindForTextField = (field: string): TextStyleFieldKind => {
  const normalized = field.toLowerCase();
  if (
    normalized === 'title' ||
    normalized === 'heading' ||
    (normalized.endsWith('title') && !normalized.includes('sub'))
  )
    return 'heading';
  if (
    normalized === 'subtitle' ||
    normalized === 'subheading' ||
    normalized.includes('subtitle') ||
    normalized.includes('subheading')
  )
    return 'subtitle';
  return 'body';
};

export const assertSingleFieldKind = (
  candidates: readonly TextEditCandidate[],
): TextStyleFieldKind => {
  if (candidates.length === 0)
    throw new DomainError(
      'validation_error',
      'No editable text found.',
      { code: 'text_target_not_found' },
    );
  const kinds = new Set(candidates.map((item) => fieldKindForTextField(item.field)));
  if (kinds.size > 1)
    throw new DomainError(
      'validation_error',
      'Style edits require a single text type.',
      { code: 'text_style_mixed_field_kinds' },
    );
  return fieldKindForTextField(candidates[0]!.field);
};

const styleFieldName = (field: string): string => `${field}Style`;

const readStyleObject = (
  sections: unknown,
  sectionIndex: number,
  field: string,
): Record<string, unknown> => {
  if (!Array.isArray(sections)) return {};
  const section = sections[sectionIndex];
  if (section === null || typeof section !== 'object' || Array.isArray(section))
    return {};
  const raw = (section as Record<string, unknown>)[styleFieldName(field)];
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw))
    return { ...(raw as Record<string, unknown>) };
  return {};
};

const parseHex = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/u.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9A-Fa-f]{6}$/u.test(trimmed)) return `#${trimmed.toUpperCase()}`;
  return null;
};

export const parseClientHex = (raw: string): string | null => parseHex(raw);

export const readTextStyleBaseline = (
  sections: unknown,
  candidate: TextEditCandidate,
): TextStyleBaseline => {
  const style = readStyleObject(sections, candidate.sectionIndex, candidate.field);
  const color = parseHex(style.color) ?? DEFAULT_BASELINE.color;
  const fontSizeRaw = style.fontSize ?? style.fontSizePx;
  const fontSizePx =
    typeof fontSizeRaw === 'number' &&
    Number.isInteger(fontSizeRaw) &&
    fontSizeRaw > 0
      ? fontSizeRaw
      : DEFAULT_BASELINE.fontSizePx;
  const weightRaw = style.fontWeight;
  const fontWeight =
    weightRaw === 400 || weightRaw === 600 || weightRaw === 700
      ? weightRaw
      : DEFAULT_BASELINE.fontWeight;
  return { color, fontSizePx, fontWeight };
};

const clampChannel = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));

export const adjustHexLightness = (
  hex: string,
  mode: 'darken50' | 'lighten50',
): string => {
  const normalized = parseHex(hex);
  if (normalized === null)
    throw new DomainError('validation_error', 'Invalid color code.', {
      code: 'text_style_color_invalid',
    });
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const factor = mode === 'darken50' ? 0.5 : 1.5;
  const next = `#${[r, g, b]
    .map((channel) =>
      clampChannel(channel * factor)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
  return next;
};

export const resolveStylePatch = (input: Readonly<{
  baseline: TextStyleBaseline;
  colorMode?: 'hex' | 'darken50' | 'lighten50';
  fontSizeDeltaPx?: 4 | 8 | 16 | 32;
  fontWeight?: 400 | 600 | 700;
  hex?: string;
}>): TextStylePatch => {
  const patch: {
    color?: string;
    fontSizePx?: number;
    fontWeight?: 400 | 600 | 700;
  } = {};
  if (input.fontWeight !== undefined) patch.fontWeight = input.fontWeight;
  if (input.fontSizeDeltaPx !== undefined)
    patch.fontSizePx = input.baseline.fontSizePx + input.fontSizeDeltaPx;
  if (input.colorMode === 'hex') {
    const hex = parseHex(input.hex ?? '');
    if (hex === null)
      throw new DomainError('validation_error', 'Invalid color code.', {
        code: 'text_style_color_invalid',
      });
    patch.color = hex;
  } else if (input.colorMode === 'darken50' || input.colorMode === 'lighten50') {
    patch.color = adjustHexLightness(input.baseline.color, input.colorMode);
  }
  if (
    patch.color === undefined &&
    patch.fontSizePx === undefined &&
    patch.fontWeight === undefined
  )
    throw new DomainError(
      'validation_error',
      'At least one style attribute is required.',
      { code: 'text_style_empty' },
    );
  return patch;
};

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const buildInlineStyleAttribute = (style: TextStylePatch): string => {
  const parts: string[] = [];
  if (style.fontWeight !== undefined)
    parts.push(`font-weight:${String(style.fontWeight)}`);
  if (style.fontSizePx !== undefined)
    parts.push(`font-size:${String(style.fontSizePx)}px`);
  if (style.color !== undefined) parts.push(`color:${style.color}`);
  return parts.join(';');
};

const weightClassFor = (weight: 400 | 600 | 700 | undefined): string | undefined => {
  if (weight === 700) return 'font-bold';
  if (weight === 600) return 'font-semibold';
  if (weight === 400) return 'font-normal';
  return undefined;
};

/** Wrap the matched excerpt in a Binflow style span (first match only). */
export const wrapExcerptWithStyle = (
  fieldValue: string,
  excerpt: string,
  style: TextStylePatch,
): string => {
  const matched = resolveMatchedExcerpt(fieldValue, excerpt);
  if (matched === null)
    throw new DomainError(
      'validation_error',
      'Style excerpt is no longer present in the target field.',
      { code: 'text_target_stale' },
    );
  const styleAttr = buildInlineStyleAttribute(style);
  const weightClass = weightClassFor(style.fontWeight);
  const classAttr =
    weightClass === undefined ? '' : ` class="${weightClass}"`;
  const styleAttrHtml =
    styleAttr.length === 0 ? '' : ` style="${styleAttr}"`;
  const wrapped = `<span${classAttr}${styleAttrHtml} data-binflow-style="1">${matched}</span>`;
  const existing = new RegExp(
    `<span(?=[^>]*\\bdata-binflow-style="1")[^>]*>${escapeRegExp(matched)}</span>`,
    'u',
  );
  if (existing.test(fieldValue)) return fieldValue.replace(existing, wrapped);
  const index = fieldValue.indexOf(matched);
  if (index < 0)
    throw new DomainError(
      'validation_error',
      'Style excerpt is no longer present in the target field.',
      { code: 'text_target_stale' },
    );
  return (
    fieldValue.slice(0, index) +
    wrapped +
    fieldValue.slice(index + matched.length)
  );
};

/**
 * Apply style by wrapping `excerpt` in an inline span inside the locale field.
 * Also merges chosen attributes into `${field}Style` for baseline continuity.
 */
export const applyTextStylePatch = (
  sections: unknown,
  patch: Readonly<{
    excerpt: string;
    field: string;
    locale: SupportedLocale;
    sectionIndex: number;
    style: TextStylePatch;
  }>,
): unknown => {
  if (!Array.isArray(sections))
    throw new Error('Page sections must be an array.');
  const cloned = structuredClone(sections);
  const section = cloned[patch.sectionIndex];
  if (section === null || typeof section !== 'object' || Array.isArray(section))
    throw new Error('Target section is missing.');
  const record = section as Record<string, unknown>;
  const current = record[patch.field];
  let fieldValue: string | null = null;
  if (typeof current === 'string') fieldValue = current;
  else if (
    current !== null &&
    typeof current === 'object' &&
    !Array.isArray(current)
  ) {
    const localeValue = (current as Record<string, unknown>)[patch.locale];
    if (typeof localeValue === 'string') fieldValue = localeValue;
  }
  if (fieldValue === null) throw new Error('Target field value is missing.');
  const updated = wrapExcerptWithStyle(fieldValue, patch.excerpt, patch.style);
  const withText = applyTextFieldPatch(cloned, {
    field: patch.field,
    locale: patch.locale,
    newValue: updated,
    sectionIndex: patch.sectionIndex,
  });
  const next = structuredClone(withText) as unknown[];
  const nextSection = next[patch.sectionIndex] as Record<string, unknown>;
  const styleKey = styleFieldName(patch.field);
  const styleCurrent =
    nextSection[styleKey] !== null &&
    typeof nextSection[styleKey] === 'object' &&
    !Array.isArray(nextSection[styleKey])
      ? { ...(nextSection[styleKey] as Record<string, unknown>) }
      : {};
  if (patch.style.fontWeight !== undefined)
    styleCurrent.fontWeight = patch.style.fontWeight;
  if (patch.style.fontSizePx !== undefined)
    styleCurrent.fontSize = patch.style.fontSizePx;
  if (patch.style.color !== undefined) styleCurrent.color = patch.style.color;
  nextSection[styleKey] = styleCurrent;
  return next;
};
