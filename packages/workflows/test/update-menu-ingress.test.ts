import { describe, expect, it } from 'vitest';

import { selectAllMenuCtaKeys, toggleMenuCtaSelection } from '@binflow/menu';

import {
  buildUpdateMenuSelectionActionSpecs,
  buildUpdateMenuSelectionMessage,
  updateMenuActionLabels,
  updateMenuEmptySelectionMessage,
  updateMenuSelectPrompt,
} from '../src/update-menu-ingress.js';

const sampleCtas = [
  {
    currentHref: '/old-a.pdf',
    field: 'ctaHref' as const,
    key: 'bistro:0:ctaHref',
    label: 'Speisekarte',
    pageId: 'p1',
    pageSlug: 'bistro',
    pageTitle: 'Bistro',
    sectionIndex: 0,
  },
  {
    currentHref: '/old-b.pdf',
    field: 'ctaHref' as const,
    key: 'home:1:ctaHref',
    label: 'Menü PDF',
    pageId: 'p2',
    pageSlug: 'home',
    pageTitle: 'Home',
    sectionIndex: 1,
  },
];

describe('update menu ingress copy', () => {
  it('uses publish-menu labels instead of create-draft wording', () => {
    for (const locale of ['es', 'en', 'de'] as const) {
      expect(updateMenuActionLabels[locale].confirmPlan.toLowerCase()).not.toMatch(
        /borrador|draft|entwurf/u,
      );
    }
  });

  it('uses Continuar / Continue / Weiter for selection confirm', () => {
    expect(updateMenuActionLabels.es.confirmSelection).toBe('Continuar');
    expect(updateMenuActionLabels.en.confirmSelection).toBe('Continue');
    expect(updateMenuActionLabels.de.confirmSelection).toBe('Weiter');
  });

  it('localizes Select all and Cancel', () => {
    expect(updateMenuActionLabels.es.selectAll).toBe('Seleccionar todos');
    expect(updateMenuActionLabels.en.selectAll).toBe('Select all');
    expect(updateMenuActionLabels.de.selectAll).toBe('Alle auswählen');
    expect(updateMenuActionLabels.es.cancel).toBe('Cancelar');
    expect(updateMenuActionLabels.en.cancel).toBe('Cancel');
    expect(updateMenuActionLabels.de.cancel).toBe('Abbrechen');
  });
});

describe('update menu opt-in selection UX', () => {
  it('prompts that nothing is selected yet', () => {
    expect(updateMenuSelectPrompt.es).toMatch(/ninguno está marcado/iu);
    expect(updateMenuSelectPrompt.en).toMatch(/none are selected/iu);
    expect(updateMenuSelectPrompt.de).toMatch(/keiner ist markiert/iu);
  });

  it('builds a selection message with zero marks and selected count', () => {
    const message = buildUpdateMenuSelectionMessage('es', [], sampleCtas);
    expect(message).toContain('Seleccionados: 0');
    expect(message).not.toContain('✓ Speisekarte');
    expect(message).toContain('Speisekarte · /bistro');
    expect(message).toContain('Menü PDF · /home');
  });

  it('marks only chosen CTAs with a check', () => {
    const message = buildUpdateMenuSelectionMessage(
      'es',
      [sampleCtas[0]!],
      sampleCtas,
    );
    expect(message).toContain('Seleccionados: 1');
    expect(message).toContain('✓ Speisekarte · /bistro');
    expect(message).not.toContain('✓ Menü PDF');
  });

  it('starts keyboard with no CTA checked, plus Select all, Continuar, Cancel', () => {
    const specs = buildUpdateMenuSelectionActionSpecs('es', sampleCtas, []);
    expect(specs.map((spec) => spec.action)).toEqual([
      'toggle_menu_cta',
      'toggle_menu_cta',
      'select_all_menu_ctas',
      'confirm_menu_selection',
      'cancel',
    ]);
    expect(specs[0]?.label).toBe('Speisekarte · /bistro');
    expect(specs[0]?.label.startsWith('✓')).toBe(false);
    expect(specs[2]?.label).toBe('Seleccionar todos');
    expect(specs[3]?.label).toBe('Continuar');
    expect(specs[4]?.label).toBe('Cancelar');
  });

  it('shows checks on toggles after select-all keys', () => {
    const allKeys = selectAllMenuCtaKeys(sampleCtas);
    expect(allKeys).toEqual(['bistro:0:ctaHref', 'home:1:ctaHref']);
    const specs = buildUpdateMenuSelectionActionSpecs('en', sampleCtas, allKeys);
    expect(specs[0]?.label.startsWith('✓')).toBe(true);
    expect(specs[1]?.label.startsWith('✓')).toBe(true);
    expect(specs.find((spec) => spec.action === 'confirm_menu_selection')?.label).toBe(
      'Continue',
    );
  });

  it('toggles add then remove keys from an empty start', () => {
    const afterFirst = toggleMenuCtaSelection([], 'bistro:0:ctaHref');
    expect(afterFirst).toEqual(['bistro:0:ctaHref']);
    const afterSecond = toggleMenuCtaSelection(afterFirst, 'home:1:ctaHref');
    expect(afterSecond).toEqual(['bistro:0:ctaHref', 'home:1:ctaHref']);
    const afterRemove = toggleMenuCtaSelection(afterSecond, 'bistro:0:ctaHref');
    expect(afterRemove).toEqual(['home:1:ctaHref']);
  });

  it('uses pick-at-least-one copy distinct from no-CTAs-found', () => {
    expect(updateMenuEmptySelectionMessage.es).toMatch(/al menos un botón/iu);
    expect(updateMenuEmptySelectionMessage.en).toMatch(/at least one button/iu);
    expect(updateMenuEmptySelectionMessage.de).toMatch(/mindestens einen Button/iu);
    expect(updateMenuEmptySelectionMessage.es).not.toMatch(/no encontramos/iu);
  });
});
