import {
  editTextInputSchema,
  type EditTextInput,
  type SupportedLocale,
} from '@binflow/contracts';
import type { ProjectManifest } from '@binflow/contracts';
import type { TextEditCandidate } from '@binflow/text';

export const editTextActionLabels = {
  de: {
    approvePreview: 'Freigeben',
    cancel: 'Abbrechen',
    confirmPlan: 'Text veröffentlichen',
    confirmTarget: 'Text bestätigen',
    pickTarget: 'Auswählen',
  },
  en: {
    approvePreview: 'Approve',
    cancel: 'Cancel',
    confirmPlan: 'Publish text',
    confirmTarget: 'Confirm text',
    pickTarget: 'Select',
  },
  es: {
    approvePreview: 'Aprobar',
    cancel: 'Cancelar',
    confirmPlan: 'Publicar texto',
    confirmTarget: 'Confirmar texto',
    pickTarget: 'Elegir',
  },
} as const;

export const editTextGuidance = {
  de: 'Sende den **aktuellen Text**, den du ändern möchtest (ein Absatz oder Abschnittstitel).',
  en: 'Send the **current text** you want to change (one paragraph or section title).',
  es: 'Envía el **texto actual** que quieres cambiar (un párrafo o título de sección).',
} as const;

export const editTextLocalePrompt = {
  de: 'Welche Sprache soll geändert werden?',
  en: 'Which language should be edited?',
  es: '¿Qué idioma quieres editar?',
} as const;

export const editTextReplacementPrompt = {
  de: 'Sende den **neuen Text** (Ersetzung wörtlich, ohne Umformulierung).',
  en: 'Send the **new text** (literal replacement, no paraphrasing).',
  es: 'Envía el **texto nuevo** (reemplazo literal, sin parafrasear).',
} as const;

export const editTextTargetNotFoundMessage = {
  de: 'Kein bearbeitbarer Text gefunden. Versuche einen längeren Auszug.',
  en: 'No editable text found. Try a longer excerpt.',
  es: 'No encontramos texto editable. Prueba con un fragmento más largo.',
} as const;

export const editTextEmptyReplacementMessage = {
  de: 'Der neue Text darf nicht leer sein.',
  en: 'Replacement text cannot be empty.',
  es: 'El texto nuevo no puede estar vacío.',
} as const;

export const buildEditTextDisambiguationMessage = (
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

export const buildEditTextTargetConfirmMessage = (
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

export const buildEditTextPlanMessage = (
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

export const parseEditTextExecuteInput = (
  projectId: string,
  collect: Extract<EditTextInput, { mode: 'collect' }>,
): Extract<EditTextInput, { mode: 'execute' }> => {
  const parsed = editTextInputSchema.parse({
    contentLocale: collect.contentLocale,
    mode: 'execute',
    newValue: collect.newValue,
    projectId,
    targetKey: collect.targetKey,
  });
  if (parsed.mode !== 'execute')
    throw new Error('Edit text execute input expected.');
  return parsed;
};

export const resolveEditTextProductionOrigin = (
  manifest: Pick<ProjectManifest, 'deployment'>,
): string => {
  const fromManifest = manifest.deployment?.productionOrigin;
  if (typeof fromManifest === 'string' && fromManifest.trim().length > 0)
    return fromManifest.replace(/\/$/u, '');
  throw new Error('Manifest deployment.productionOrigin is required.');
};

export const editTextNaturalLanguage = (text: string): boolean =>
  /\b(edit(?:ar)?(?:\s+\w+){0,3}\s+(?:text|texto|copy|p[aá]rrafo)|cambiar\s+texto|text\s+[aä]ndern|edit\s+text|edit\s+copy|change\s+(?:text|copy|paragraph))\b/iu.test(
    text,
  );

export const formatEditTextPickLabel = (
  locale: SupportedLocale,
  index: number,
  candidate: TextEditCandidate,
): string => {
  const prefix = editTextActionLabels[locale].pickTarget;
  return `${prefix} ${index + 1}: ${candidate.pageTitle}`;
};
