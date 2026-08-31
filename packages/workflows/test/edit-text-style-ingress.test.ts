import { describe, expect, it } from 'vitest';

import { editTextNaturalLanguage } from '../src/edit-text-ingress.js';
import {
  buildEditTextStylePlanMessage,
  editTextStyleActionLabels,
  editTextStyleHexPrompt,
  editTextStyleMixedKindsMessage,
  editTextStyleNaturalLanguage,
} from '../src/edit-text-style-ingress.js';

describe('edit-text-style ingress', () => {
  it('matches style phrases but not the bare edit-text command', () => {
    expect(editTextStyleNaturalLanguage('Cambiar tamaño y negrita')).toBe(true);
    expect(editTextStyleNaturalLanguage('Make this font bold')).toBe(true);
    expect(editTextStyleNaturalLanguage('Schriftgröße ändern')).toBe(true);
    expect(editTextStyleNaturalLanguage('edit text style')).toBe(true);
    expect(editTextStyleNaturalLanguage('change text style')).toBe(true);
    expect(editTextStyleNaturalLanguage('Schriftstil anpassen')).toBe(true);
    expect(editTextStyleNaturalLanguage('/edit_text')).toBe(false);
  });

  it('routes English style phrases to style, not bare edit_text', () => {
    expect(editTextStyleNaturalLanguage('edit text style')).toBe(true);
    expect(editTextNaturalLanguage('edit text style')).toBe(true);
    expect(editTextStyleNaturalLanguage('change text style')).toBe(true);
    expect(editTextNaturalLanguage('change text style')).toBe(true);
    expect(editTextStyleNaturalLanguage('cambiar texto')).toBe(false);
    expect(editTextNaturalLanguage('cambiar texto')).toBe(true);
  });

  it('uses style-specific action labels', () => {
    expect(editTextStyleActionLabels.es.confirmPlan).toBe('Aplicar estilo');
    expect(editTextStyleActionLabels.en.confirmPlan).toBe('Apply style');
    expect(editTextStyleActionLabels.es.attrWeight).toBe('Grosor');
    expect(editTextStyleActionLabels.es.attrSize).toBe('Tamaño');
    expect(editTextStyleActionLabels.es.attrColor).toBe('Color');
    expect(editTextStyleActionLabels.es.confirmPlan).not.toContain('texto');
  });

  it('explains when the target text is missing', async () => {
    const { editTextStyleTargetNotFoundMessage } = await import(
      '../src/edit-text-style-ingress.js'
    );
    expect(editTextStyleTargetNotFoundMessage.es).toMatch(/no encontramos/iu);
    expect(editTextStyleTargetNotFoundMessage.es).toMatch(/otra|otro|prueba/iu);
  });

  it('provides mixed-kind and hex guidance', () => {
    expect(editTextStyleMixedKindsMessage.es.length).toBeGreaterThan(0);
    expect(editTextStyleHexPrompt.es).toContain('#FF5500');
  });

  it('builds a human plan summary without JSON keys', () => {
    const candidate = {
      currentValue: 'Bienvenidos',
      field: 'subtitle',
      key: 'page:home:0:subtitle:es',
      label: 'Bienvenidos',
      locale: 'es' as const,
      pageId: 'p1',
      pageSlug: 'home',
      pageTitle: 'Inicio',
      sectionIndex: 0,
    };
    const message = buildEditTextStylePlanMessage('es', candidate, {
      color: '#FF5500',
      fontSizePx: 24,
      fontWeight: 700,
    });
    expect(message).toContain('/home');
    expect(message).toContain('Bienvenidos');
    expect(message).toContain('Negrita');
    expect(message).toContain('24px');
    expect(message).toContain('#FF5500');
    expect(message).not.toContain('fontSizePx');
    expect(message).not.toContain('{');
    expect(message).not.toContain('JSON');
  });
});
