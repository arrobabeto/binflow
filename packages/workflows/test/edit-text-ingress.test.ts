import { describe, expect, it } from 'vitest';

import {
  editTextActionLabels,
  editTextNaturalLanguage,
} from '../src/edit-text-ingress.js';

describe('edit-text ingress', () => {
  it('matches natural-language edit intents', () => {
    expect(editTextNaturalLanguage('Quiero editar un párrafo del sitio')).toBe(true);
    expect(editTextNaturalLanguage('Text ändern auf der Startseite')).toBe(true);
    expect(editTextNaturalLanguage('update menu pdf')).toBe(false);
  });

  it('uses edit-specific preview labels without revision', () => {
    expect(editTextActionLabels.es.approvePreview).toBe('Aprobar');
    expect(editTextActionLabels.es.confirmPlan).toBe('Publicar texto');
    expect(editTextActionLabels.en.cancel).toBe('Cancel');
  });
});
