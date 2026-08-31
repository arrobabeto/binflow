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
    confirmPlan: 'Menü veröffentlichen',
    confirmSelection: 'Auswahl bestätigen',
  },
  en: {
    confirmPlan: 'Publish menu',
    confirmSelection: 'Confirm selection',
  },
  es: {
    confirmPlan: 'Publicar menú',
    confirmSelection: 'Confirmar selección',
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

export const updateMenuSelectPrompt = {
  de: 'Wähle die Buttons, die zum PDF führen sollen. Tippe **Auswahl bestätigen**, wenn du fertig bist.',
  en: 'Select the buttons that should open the PDF. Tap **Confirm selection** when done.',
  es: 'Elige los botones que deben abrir el PDF. Pulsa **Confirmar selección** cuando termines.',
} as const;

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
  const copy = {
    de: `${updateMenuSelectPrompt.de}\n\n${lines.join('\n')}`,
    en: `${updateMenuSelectPrompt.en}\n\n${lines.join('\n')}`,
    es: `${updateMenuSelectPrompt.es}\n\n${lines.join('\n')}`,
  } as const;
  return copy[locale];
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
