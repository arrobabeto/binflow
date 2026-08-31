import {
  updateMenuInputSchema,
  type SupportedLocale,
  type UpdateMenuInput,
} from '@binflow/contracts';
import type { ProjectManifest } from '@binflow/contracts';
import {
  buildVersionedMenuPdfPath,
  publicUrlForMenuPdfPath,
  type MenuCtaCandidate,
} from '@binflow/menu';

export const updateMenuActionLabels = {
  de: {
    cancel: 'Abbrechen',
    confirmPlan: 'Menü veröffentlichen',
    confirmSelection: 'Weiter',
    selectAll: 'Alle auswählen',
  },
  en: {
    cancel: 'Cancel',
    confirmPlan: 'Publish menu',
    confirmSelection: 'Continue',
    selectAll: 'Select all',
  },
  es: {
    cancel: 'Cancelar',
    confirmPlan: 'Publicar menú',
    confirmSelection: 'Continuar',
    selectAll: 'Seleccionar todos',
  },
} as const;

export const updateMenuGuidance = {
  de: 'Sende das Menü als PDF (max. 10 MB).',
  en: 'Send the menu PDF (max 10 MB).',
  es: 'Envía el PDF del menú (máx. 10 MB).',
} as const;

export const updateMenuPdfRejectedMessage = {
  de: 'Die Datei muss ein PDF sein (max. 10 MB).',
  en: 'File must be a PDF (max 10 MB).',
  es: 'El archivo debe ser PDF (máx. 10 MB).',
} as const;

export const updateMenuNoCtasMessage = {
  de: 'Keine bearbeitbaren Menü-Buttons gefunden.',
  en: 'No editable menu buttons found.',
  es: 'No encontramos botones de menú editables.',
} as const;

export const updateMenuEmptySelectionMessage = {
  de: 'Wähle mindestens einen Button aus.',
  en: 'Choose at least one button.',
  es: 'Elige al menos un botón.',
} as const;

export const updateMenuSelectPrompt = {
  de: 'Tippe die Buttons, die du mit diesem PDF aktualisieren willst. Noch keiner ist markiert. Dann **Weiter**.',
  en: 'Tap the buttons you want to update with this PDF. None are selected yet. Then tap **Continue**.',
  es: 'Toca los botones que quieres actualizar con este PDF. Ninguno está marcado. Luego pulsa **Continuar**.',
} as const;

const selectedCountLine = (
  locale: SupportedLocale,
  count: number,
): string => {
  const copy = {
    de: `Ausgewählt: ${String(count)}`,
    en: `Selected: ${String(count)}`,
    es: `Seleccionados: ${String(count)}`,
  } as const;
  return copy[locale];
};

export const buildUpdateMenuPlanMessage = (
  locale: SupportedLocale,
  pdfUrl: string,
  selected: readonly MenuCtaCandidate[],
): string => {
  const lines = selected.map(
    (cta) => `· ${cta.label} (/${cta.pageSlug})`,
  );
  const copy = {
    de: `Plan: **${selected.length}** Menü-Buttons mit dem PDF aktualisieren.\nPDF: ${pdfUrl}\n${lines.join('\n')}`,
    en: `Plan: update **${selected.length}** menu buttons with the uploaded PDF.\nPDF: ${pdfUrl}\n${lines.join('\n')}`,
    es: `Plan: actualizar **${selected.length}** botones de menú con el PDF subido.\nPDF: ${pdfUrl}\n${lines.join('\n')}`,
  } as const;
  return copy[locale];
};

export const buildUpdateMenuSelectionMessage = (
  locale: SupportedLocale,
  selected: readonly MenuCtaCandidate[],
  discovered: readonly MenuCtaCandidate[],
): string => {
  const selectedKeys = new Set(selected.map((cta) => cta.key));
  const lines = discovered.map((cta) => {
    const mark = selectedKeys.has(cta.key) ? '✓ ' : '';
    return `${mark}${cta.label} · /${cta.pageSlug}`;
  });
  return `${updateMenuSelectPrompt[locale]}\n\n${selectedCountLine(locale, selected.length)}\n${lines.join('\n')}`;
};

/** Specs for selection-step Telegram buttons (tokens filled by collection). */
export type UpdateMenuSelectionActionSpec = Readonly<{
  action:
    | 'toggle_menu_cta'
    | 'select_all_menu_ctas'
    | 'confirm_menu_selection'
    | 'cancel';
  label: string;
  /** Value stored on the action token (may include CTA key suffix). */
  tokenAction: string;
}>;

export const buildUpdateMenuSelectionActionSpecs = (
  locale: SupportedLocale,
  discovered: readonly MenuCtaCandidate[],
  selectedKeys: readonly string[],
): readonly UpdateMenuSelectionActionSpec[] => {
  const selected = new Set(selectedKeys);
  const specs: UpdateMenuSelectionActionSpec[] = [];
  for (const cta of discovered.slice(0, 8)) {
    specs.push({
      action: 'toggle_menu_cta',
      label: formatMenuToggleLabel(cta, selected.has(cta.key)),
      tokenAction: `toggle_menu_cta:${cta.key}`,
    });
  }
  specs.push({
    action: 'select_all_menu_ctas',
    label: updateMenuActionLabels[locale].selectAll,
    tokenAction: 'select_all_menu_ctas',
  });
  specs.push({
    action: 'confirm_menu_selection',
    label: updateMenuActionLabels[locale].confirmSelection,
    tokenAction: 'confirm_menu_selection',
  });
  specs.push({
    action: 'cancel',
    label: updateMenuActionLabels[locale].cancel,
    tokenAction: 'cancel',
  });
  return specs;
};

export const parseUpdateMenuExecuteInput = (
  projectId: string,
  requestVersionId: string,
  productionOrigin: string,
  collect: Extract<UpdateMenuInput, { mode: 'collect' }>,
): Extract<UpdateMenuInput, { mode: 'execute' }> => {
  const menuPdfPublicPath =
    collect.menuPdfPublicPath ??
    buildVersionedMenuPdfPath(requestVersionId);
  const parsed = updateMenuInputSchema.parse({
    menuPdfPublicPath,
    menuPdfPublicUrl: publicUrlForMenuPdfPath(
      productionOrigin,
      menuPdfPublicPath,
    ),
    mode: 'execute',
    pdfArtifactKey: collect.pdfArtifactKey,
    pdfFileName: collect.pdfFileName,
    projectId,
    selectedCtaKeys: collect.selectedCtaKeys,
  });
  if (parsed.mode !== 'execute')
    throw new Error('Update menu execute input expected.');
  return parsed;
};

export const resolveUpdateMenuProductionOrigin = (
  manifest: Pick<ProjectManifest, 'deployment' | 'profile'>,
): string => {
  const fromManifest = manifest.deployment?.productionOrigin;
  if (typeof fromManifest === 'string' && fromManifest.trim().length > 0)
    return fromManifest.replace(/\/$/u, '');
  throw new Error('Manifest deployment.productionOrigin is required.');
};

export const formatMenuToggleLabel = (
  candidate: MenuCtaCandidate,
  selected: boolean,
): string => `${selected ? '✓ ' : ''}${candidate.label} · /${candidate.pageSlug}`;

export const parseMenuCtaKeywordSection = (
  section: string | undefined,
): readonly string[] =>
  (section ?? '')
    .split(/[,;|\n]/u)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
