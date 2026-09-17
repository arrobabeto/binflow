import {
  editTextShopifyInputSchema,
  type EditTextShopifyInput,
  type SupportedLocale,
  type TextEditCandidate,
} from '@binflow/contracts';
import type { ProjectManifest } from '@binflow/contracts';

export const editTextShopifyActionLabels = {
  de: {
    approvePreview: 'Freigeben',
    cancel: 'Abbrechen',
    confirmPlan: 'Text veröffentlichen',
    confirmTarget: 'Text bestätigen',
    pickTarget: 'Auswählen',
    rejectTarget: 'Nicht dieses',
  },
  en: {
    approvePreview: 'Approve',
    cancel: 'Cancel',
    confirmPlan: 'Publish text',
    confirmTarget: 'Confirm text',
    pickTarget: 'Select',
    rejectTarget: 'Not this one',
  },
  es: {
    approvePreview: 'Aprobar',
    cancel: 'Cancelar',
    confirmPlan: 'Publicar texto',
    confirmTarget: 'Confirmar texto',
    pickTarget: 'Elegir',
    rejectTarget: 'No es este',
  },
} as const;

export const editTextShopifyGuidance = {
  de: 'Sende den **aktuellen Text**, den du ändern möchtest (ein Absatz oder Abschnittstitel).',
  en: 'Send the **current text** you want to change (one paragraph or section title).',
  es: 'Envía el **texto actual** que quieres cambiar (un párrafo o título de sección).',
} as const;

export const editTextShopifyReplacementPrompt = {
  de: 'Sende den **neuen Text** (Ersetzung wörtlich, ohne Umformulierung).',
  en: 'Send the **new text** (literal replacement, no paraphrasing).',
  es: 'Envía el **texto nuevo** (reemplazo literal, sin parafrasear).',
} as const;

export const editTextShopifyTargetNotFoundMessage = {
  de: 'Kein bearbeitbarer Text gefunden. Versuche einen längeren Auszug (Fließtext/Untertitel — große Überschriften oft nur für Stil).',
  en: 'No editable text found. Try a longer excerpt (body/subheading — main headings are often style-only).',
  es: 'No encontramos texto editable. Prueba un fragmento más largo (cuerpo/subtítulo — los títulos grandes suelen ser solo estilo).',
} as const;

/** Miss copy when the enriched catalog already includes non-home areas. */
export const buildEditTextShopifyTargetNotFoundMessage = (
  locale: SupportedLocale,
  catalogAreas: readonly string[],
): string => {
  const nonHome = [
    ...new Set(
      catalogAreas
        .map((area) => area.trim().toLowerCase())
        .filter((area) => area.length > 0 && area !== 'home'),
    ),
  ].sort();
  if (nonHome.length === 0) return editTextShopifyTargetNotFoundMessage[locale];
  const areas = nonHome.join(', ');
  const copy = {
    de: `Kein bearbeitbarer Text gefunden. Nutze Fließtext oder Untertitel (große Überschriften sind oft nur Stil). Katalog enthält auch: ${areas}.`,
    en: `No editable text found. Use body copy or a subheading (main headings are often style-only). Catalog also includes: ${areas}.`,
    es: `No encontramos texto editable. Usa cuerpo o subtítulo (los títulos grandes suelen ser solo estilo). El catálogo también incluye: ${areas}.`,
  } as const;
  return copy[locale];
};

export const editTextShopifyStyleTargetMissMessage = {
  de: 'Dieser Text ist eine **Überschrift für Stil** (nicht mit /edit_text änderbar). Sende Fließtext oder einen Untertitel.',
  en: 'That text is a **style heading** (not editable with /edit_text). Send body copy or a subheading instead.',
  es: 'Ese texto es un **título de estilo** (no se edita con /edit_text). Envía el cuerpo o un subtítulo.',
} as const;

export const editTextShopifyEmptyReplacementMessage = {
  de: 'Der neue Text darf nicht leer sein.',
  en: 'Replacement text cannot be empty.',
  es: 'El texto nuevo no puede estar vacío.',
} as const;

export const buildEditTextShopifyDisambiguationMessage = (
  locale: SupportedLocale,
  matches: readonly TextEditCandidate[],
): string => {
  const lines = matches.map(
    (match, index) =>
      `${index + 1}. ${match.pageTitle} · /${match.pageSlug}\n   «${match.label}»`,
  );
  const copy = {
    de: `Mehrere Treffer. Wähle den Text:\n\n${lines.join('\n\n')}`,
    en: `Multiple matches. Select the text:\n\n${lines.join('\n\n')}`,
    es: `Varios resultados. Elige el texto:\n\n${lines.join('\n\n')}`,
  } as const;
  return copy[locale];
};

export const buildEditTextShopifyTargetConfirmMessage = (
  locale: SupportedLocale,
  candidate: TextEditCandidate,
): string => {
  const copy = {
    de: `Text auf **/${candidate.pageSlug}** ändern?\n\nAktuell:\n«${candidate.currentValue}»`,
    en: `Change text on **/${candidate.pageSlug}**?\n\nCurrent:\n«${candidate.currentValue}»`,
    es: `¿Cambiar texto en **/${candidate.pageSlug}**?\n\nActual:\n«${candidate.currentValue}»`,
  } as const;
  return copy[locale];
};

export const buildEditTextShopifyPlanMessage = (
  locale: SupportedLocale,
  candidate: TextEditCandidate,
  newValue: string,
): string => {
  const copy = {
    de: `Plan: Text auf **/${candidate.pageSlug}** ersetzen.\n\nAlt:\n«${candidate.currentValue}»\n\nNeu:\n«${newValue}»`,
    en: `Plan: replace text on **/${candidate.pageSlug}**.\n\nOld:\n«${candidate.currentValue}»\n\nNew:\n«${newValue}»`,
    es: `Plan: reemplazar texto en **/${candidate.pageSlug}**.\n\nAnterior:\n«${candidate.currentValue}»\n\nNuevo:\n«${newValue}»`,
  } as const;
  return copy[locale];
};

export const parseEditTextShopifyExecuteInput = (
  projectId: string,
  collect: Extract<EditTextShopifyInput, { mode: 'collect' }>,
): Extract<EditTextShopifyInput, { mode: 'execute' }> => {
  const parsed = editTextShopifyInputSchema.parse({
    contentLocale: collect.contentLocale ?? 'en',
    mode: 'execute',
    newValue: collect.newValue,
    projectId,
    targetKey: collect.targetKey,
  });
  if (parsed.mode !== 'execute')
    throw new Error('Edit theme text execute input expected.');
  return parsed;
};

export const formatEditTextShopifyPickLabel = (
  locale: SupportedLocale,
  index: number,
  candidate: TextEditCandidate,
): string => {
  const prefix = editTextShopifyActionLabels[locale].pickTarget;
  return `${prefix} ${index + 1}: ${candidate.pageTitle}`;
};

export const buildEditTextShopifyPickActionRows = <
  T extends Readonly<{ action: string; label: string; token: string }>,
>(
  tokens: readonly T[],
): T[][] => tokens.map((token) => [token]);

export const resolveEditTextShopifyProductionOrigin = (
  manifest: Pick<ProjectManifest, 'deployment'>,
): string => {
  const fromManifest = manifest.deployment?.productionOrigin;
  if (typeof fromManifest === 'string' && fromManifest.trim().length > 0)
    return fromManifest.replace(/\/$/u, '');
  throw new Error('Manifest deployment.productionOrigin is required.');
};
