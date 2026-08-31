import {
  editTextStyleInputSchema,
  type EditTextStyleInput,
  type SupportedLocale,
} from '@binflow/contracts';
import type { ProjectManifest } from '@binflow/contracts';
import {
  resolveStylePatch,
  type TextEditCandidate,
  type TextStyleBaseline,
} from '@binflow/text';

export const editTextStyleActionLabels = {
  de: {
    approvePreview: 'Vorschau freigeben',
    attrColor: 'Farbe',
    attrSize: 'Größe',
    attrWeight: 'Gewicht',
    cancel: 'Abbrechen',
    colorDarker: 'Dunkler',
    colorLighter: 'Heller',
    confirmPlan: 'Stil anwenden',
    confirmTarget: 'Text bestätigen',
    doneStyles: 'Fertig',
    enterHex: 'Hex-Code eingeben',
    pickTarget: 'Auswählen',
    size16: '+16',
    size32: '+32',
    size4: '+4',
    size8: '+8',
    weightBold: 'Fett',
    weightNormal: 'Normal',
    weightSemi: 'Halbfett',
  },
  en: {
    approvePreview: 'Approve preview',
    attrColor: 'Color',
    attrSize: 'Size',
    attrWeight: 'Weight',
    cancel: 'Cancel',
    colorDarker: 'Darker',
    colorLighter: 'Lighter',
    confirmPlan: 'Apply style',
    confirmTarget: 'Confirm text',
    doneStyles: 'Done',
    enterHex: 'Enter hex',
    pickTarget: 'Select',
    size16: '+16',
    size32: '+32',
    size4: '+4',
    size8: '+8',
    weightBold: 'Bold',
    weightNormal: 'Normal',
    weightSemi: 'Semibold',
  },
  es: {
    approvePreview: 'Aprobar vista previa',
    attrColor: 'Color',
    attrSize: 'Tamaño',
    attrWeight: 'Grosor',
    cancel: 'Cancelar',
    colorDarker: 'Más oscuro',
    colorLighter: 'Más claro',
    confirmPlan: 'Aplicar estilo',
    confirmTarget: 'Confirmar texto',
    doneStyles: 'Listo',
    enterHex: 'Ingresar HEX',
    pickTarget: 'Elegir',
    size16: '+16',
    size32: '+32',
    size4: '+4',
    size8: '+8',
    weightBold: 'Negrita',
    weightNormal: 'Normal',
    weightSemi: 'Seminegrita',
  },
} as const;

export const editTextStyleGuidance = {
  de: 'Sende den Ausschnitt, dessen Stil du ändern möchtest. Nur dieser Ausschnitt wird gestylt.',
  en: 'Send the excerpt whose style you want to change. Only that excerpt is styled.',
  es: 'Envía el fragmento cuyo estilo quieres cambiar. Solo ese fragmento se estiliza.',
} as const;

export const editTextStyleTargetNotFoundMessage = {
  de: 'Diesen Text finden wir auf der Seite nicht. Bitte erneut senden oder einen anderen Ausschnitt versuchen.',
  en: 'We could not find that text on the page. Please try again or send a different excerpt.',
  es: 'No encontramos ese texto en la página. Inténtalo de nuevo o prueba con otro fragmento.',
} as const;

export const editTextStyleLocalePrompt = {
  de: 'Für welche Sprache soll der Textstil geändert werden?',
  en: 'Which language should receive the style change?',
  es: '¿En qué idioma quieres cambiar el estilo?',
} as const;

export const editTextStyleMixedKindsMessage = {
  de: 'Die Treffer enthalten verschiedene Textarten. Bitte starte neu und sende einen genaueren Ausschnitt.',
  en: 'The matches contain different kinds of text. Please restart with a more specific excerpt.',
  es: 'Los resultados mezclan distintos tipos de texto. Reinicia con un fragmento más específico.',
} as const;

export const editTextStyleHexPrompt = {
  de: 'Sende einen Farbcode wie #FF5500.',
  en: 'Send a color code such as #FF5500.',
  es: 'Envía un código de color como #FF5500.',
} as const;

export const editTextStyleHexRetryMessage = {
  de: 'Dieser Code ist ungültig. Versuche es erneut, zum Beispiel #FF5500.',
  en: 'That code is invalid. Try again, for example #FF5500.',
  es: 'Ese código no es válido. Intenta de nuevo, por ejemplo #FF5500.',
} as const;

export const editTextStyleHexCancelledMessage = {
  de: 'Die Anfrage wurde nach zwei ungültigen Farbcodes abgebrochen. Starte erneut.',
  en: 'The request was cancelled after two invalid color codes. Please restart.',
  es: 'La solicitud se canceló después de dos códigos inválidos. Vuelve a empezar.',
} as const;

export const editTextStyleEmptyMessage = {
  de: 'Wähle mindestens ein Stilmerkmal, bevor du fertig bist.',
  en: 'Choose at least one style attribute before finishing.',
  es: 'Elige al menos un atributo de estilo antes de terminar.',
} as const;

export const buildEditTextStyleDisambiguationMessage = (
  locale: SupportedLocale,
  matches: readonly TextEditCandidate[],
): string => {
  const list = matches
    .map((match, index) => `${String(index + 1)}. ${match.pageTitle} · /${match.pageSlug}\n   «${match.label}»`)
    .join('\n\n');
  return {
    de: `Mehrere Treffer. Wähle den Text:\n\n${list}`,
    en: `Multiple matches. Select the text:\n\n${list}`,
    es: `Varios resultados. Elige el texto:\n\n${list}`,
  }[locale];
};

export const buildEditTextStyleTargetConfirmMessage = (
  locale: SupportedLocale,
  candidate: TextEditCandidate,
  excerpt: string,
): string =>
  ({
    de: `Stil dieses Ausschnitts auf **/${candidate.pageSlug}** ändern?\n\nAusschnitt:\n«${excerpt}»\n\nIm Feld:\n«${candidate.currentValue}»`,
    en: `Change the style of this excerpt on **/${candidate.pageSlug}**?\n\nExcerpt:\n«${excerpt}»\n\nIn the field:\n«${candidate.currentValue}»`,
    es: `¿Cambiar el estilo de este fragmento en **/${candidate.pageSlug}**?\n\nFragmento:\n«${excerpt}»\n\nEn el campo:\n«${candidate.currentValue}»`,
  })[locale];

export const buildEditTextStylePickerMessage = (
  locale: SupportedLocale,
  baseline: TextStyleBaseline,
): string =>
  ({
    de: `Aktueller Stil: ${String(baseline.fontWeight)}, ${String(baseline.fontSizePx)}px, ${baseline.color}.`,
    en: `Current style: ${String(baseline.fontWeight)}, ${String(baseline.fontSizePx)}px, ${baseline.color}.`,
    es: `Estilo actual: ${String(baseline.fontWeight)}, ${String(baseline.fontSizePx)}px, ${baseline.color}.`,
  })[locale];

export const buildEditTextStyleMenuMessage = (
  locale: SupportedLocale,
  baseline: TextStyleBaseline,
  chosenSummary: string,
): string => {
  const chosenBlock =
    chosenSummary.trim().length > 0
      ? {
          de: `\n\nBisher gewählt: ${chosenSummary}`,
          en: `\n\nSelected so far: ${chosenSummary}`,
          es: `\n\nElegido hasta ahora: ${chosenSummary}`,
        }[locale]
      : '';
  return (
    {
      de: `${buildEditTextStylePickerMessage(locale, baseline)}${chosenBlock}\n\nWas möchtest du jetzt ändern? Ein Attribut pro Schritt. Tippe **Fertig**, wenn du mindestens eines gewählt hast.`,
      en: `${buildEditTextStylePickerMessage(locale, baseline)}${chosenBlock}\n\nWhat do you want to change now? One attribute per step. Tap **Done** when you have chosen at least one.`,
      es: `${buildEditTextStylePickerMessage(locale, baseline)}${chosenBlock}\n\n¿Qué quieres cambiar ahora? Un atributo por paso. Pulsa **Listo** cuando hayas elegido al menos uno.`,
    }[locale]
  );
};

export const buildEditTextStyleWeightPrompt = (locale: SupportedLocale): string =>
  ({
    de: 'Wähle das **Gewicht**:',
    en: 'Choose the **weight**:',
    es: 'Elige el **grosor**:',
  })[locale];

export const buildEditTextStyleSizePrompt = (locale: SupportedLocale): string =>
  ({
    de: 'Wähle die **Größenänderung** (Pixel mehr als jetzt):',
    en: 'Choose the **size change** (pixels more than now):',
    es: 'Elige el **cambio de tamaño** (píxeles más que ahora):',
  })[locale];

export const buildEditTextStyleColorPrompt = (locale: SupportedLocale): string =>
  ({
    de: 'Wähle die **Farbe**:',
    en: 'Choose the **color**:',
    es: 'Elige el **color**:',
  })[locale];

export const formatEditTextStylePlanSummary = (
  locale: SupportedLocale,
  style: ReturnType<typeof resolveStylePatch>,
): string => {
  const parts: string[] = [];
  if (style.fontWeight !== undefined) {
    const weightLabel =
      style.fontWeight === 700
        ? editTextStyleActionLabels[locale].weightBold
        : style.fontWeight === 600
          ? editTextStyleActionLabels[locale].weightSemi
          : editTextStyleActionLabels[locale].weightNormal;
    parts.push(
      {
        de: `Gewicht: ${weightLabel}`,
        en: `Weight: ${weightLabel}`,
        es: `Grosor: ${weightLabel}`,
      }[locale],
    );
  }
  if (style.fontSizePx !== undefined) {
    parts.push(
      {
        de: `Größe: ${String(style.fontSizePx)}px`,
        en: `Size: ${String(style.fontSizePx)}px`,
        es: `Tamaño: ${String(style.fontSizePx)}px`,
      }[locale],
    );
  }
  if (style.color !== undefined) {
    parts.push(
      {
        de: `Farbe: ${style.color}`,
        en: `Color: ${style.color}`,
        es: `Color: ${style.color}`,
      }[locale],
    );
  }
  return parts.join(' · ');
};

export const buildEditTextStylePlanMessage = (
  locale: SupportedLocale,
  candidate: TextEditCandidate,
  style: ReturnType<typeof resolveStylePatch>,
): string => {
  const summary = formatEditTextStylePlanSummary(locale, style);
  return {
    de: `Plan: Stil auf **/${candidate.pageSlug}** anwenden, ohne den Text zu ändern.\n\n«${candidate.currentValue}»\n\n${summary}`,
    en: `Plan: apply style on **/${candidate.pageSlug}** without changing its copy.\n\n«${candidate.currentValue}»\n\n${summary}`,
    es: `Plan: aplicar estilo en **/${candidate.pageSlug}** sin cambiar el texto.\n\n«${candidate.currentValue}»\n\n${summary}`,
  }[locale];
};
export const formatEditTextStylePickLabel = (
  locale: SupportedLocale,
  index: number,
  candidate: TextEditCandidate,
): string =>
  `${editTextStyleActionLabels[locale].pickTarget} ${String(index + 1)}: ${candidate.pageTitle}`;

export const parseEditTextStyleExecuteInput = (
  projectId: string,
  collect: Extract<EditTextStyleInput, { mode: 'collect' }>,
): Extract<EditTextStyleInput, { mode: 'execute' }> => {
  const style = resolveStylePatch({
    baseline: {
      color: collect.currentColor ?? '#111111',
      fontSizePx: collect.currentFontSizePx ?? 16,
      fontWeight: collect.currentFontWeight ?? 400,
    },
    ...(collect.colorMode === undefined ? {} : { colorMode: collect.colorMode }),
    ...(collect.fontSizeDeltaPx === undefined
      ? {}
      : { fontSizeDeltaPx: collect.fontSizeDeltaPx }),
    ...(collect.fontWeight === undefined
      ? {}
      : { fontWeight: collect.fontWeight }),
    ...(collect.hex === undefined ? {} : { hex: collect.hex }),
  });
  const parsed = editTextStyleInputSchema.parse({
    contentLocale: collect.contentLocale,
    mode: 'execute',
    projectId,
    style,
    targetExcerpt: collect.targetExcerpt,
    targetKey: collect.targetKey,
  });
  if (parsed.mode !== 'execute')
    throw new Error('Edit text style execute input expected.');
  return parsed;
};

export const resolveEditTextStyleProductionOrigin = (
  manifest: Pick<ProjectManifest, 'deployment'>,
): string => {
  const origin = manifest.deployment.productionOrigin;
  if (typeof origin !== 'string' || origin.trim().length === 0)
    throw new Error('Manifest deployment.productionOrigin is required.');
  return origin.replace(/\/$/u, '');
};

export const editTextStyleNaturalLanguage = (text: string): boolean =>
  /\b((?:edit|change|update)\s+text\s+style|text\s+style|estilo(?:\s+del\s+texto)?|tipograf[ií]a|tama[ñn]o|negrita|color|grosor|bold|font(?:\s+(?:size|weight|style))?|typograph(?:y|ie)|schrift(?:stil|art|gr[oö][ßs]e|st[aä]rke)|textstil|farbe)\b/iu.test(
    text,
  );
