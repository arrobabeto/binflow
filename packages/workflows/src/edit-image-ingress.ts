import {
  editImageInputSchema,
  type EditImageInput,
  type SupportedLocale,
} from '@binflow/contracts';
import type { ProjectManifest } from '@binflow/contracts';
import type { ImageEditCandidate } from '@binflow/images';

export const editImageActionLabels = {
  de: {
    approvePreview: 'Freigeben',
    cancel: 'Abbrechen',
    confirmPlan: 'Bild veröffentlichen',
    confirmTarget: 'Bild bestätigen',
    pickTarget: 'Auswählen',
    rejectTarget: 'Nicht dieses',
  },
  en: {
    approvePreview: 'Approve',
    cancel: 'Cancel',
    confirmPlan: 'Publish image',
    confirmTarget: 'Confirm image',
    pickTarget: 'Select',
    rejectTarget: 'Not this one',
  },
  es: {
    approvePreview: 'Aprobar',
    cancel: 'Cancelar',
    confirmPlan: 'Publicar imagen',
    confirmTarget: 'Confirmar imagen',
    pickTarget: 'Elegir',
    rejectTarget: 'No es esta',
  },
} as const;

export const editImageGuidance = {
  de: 'Welche **Bildstelle** soll geändert werden? Sende einen URL-Ausschnitt, Alt-Text, Seiten- oder Blogtitel.',
  en: 'Which **image** should change? Send a URL fragment, alt text, page title, or blog title.',
  es: '¿Qué **imagen** quieres cambiar? Envía un fragmento de URL, alt, título de página o del blog.',
} as const;

export const editImageReplacementPrompt = {
  de: 'Sende das **neue Bild** als Foto-Anhang oder HTTPS-URL (JPEG, PNG oder WebP).',
  en: 'Send the **new image** as a photo attachment or HTTPS URL (JPEG, PNG, or WebP).',
  es: 'Envía la **imagen nueva** como foto adjunta o URL HTTPS (JPEG, PNG o WebP).',
} as const;

export const editImageTargetNotFoundMessage = {
  de: 'Kein bearbeitbares Bild gefunden. Versuche einen längeren Ausschnitt oder den Seitentitel.',
  en: 'No editable image found. Try a longer fragment or the page title.',
  es: 'No encontramos imagen editable. Prueba con un fragmento más largo o el título.',
} as const;

export const editImageEmptyReplacementMessage = {
  de: 'Sende ein Foto oder eine gültige HTTPS-Bild-URL.',
  en: 'Send a photo or a valid HTTPS image URL.',
  es: 'Envía una foto o una URL HTTPS de imagen válida.',
} as const;

export const editImageInvalidReplacementMessage = {
  de: 'Das Ersatzbild ist ungültig. Nur JPEG, PNG oder WebP (max. 8 MB).',
  en: 'Replacement image is invalid. Only JPEG, PNG, or WebP (max 8 MB).',
  es: 'La imagen de reemplazo no es válida. Solo JPEG, PNG o WebP (máx. 8 MB).',
} as const;

export const buildEditImageDisambiguationMessage = (
  locale: SupportedLocale,
  matches: readonly ImageEditCandidate[],
): string => {
  const lines = matches.map(
    (match, index) =>
      `${index + 1}. ${match.pageOrPostTitle} · /${match.pageOrPostSlug}\n   ${match.label}`,
  );
  const copy = {
    de: `Mehrere Treffer. Wähle das Bild:\n\n${lines.join('\n\n')}`,
    en: `Multiple matches. Select the image:\n\n${lines.join('\n\n')}`,
    es: `Varios resultados. Elige la imagen:\n\n${lines.join('\n\n')}`,
  } as const;
  return copy[locale];
};

export const buildEditImageTargetConfirmMessage = (
  locale: SupportedLocale,
  candidate: ImageEditCandidate,
  imageUrl?: string,
): string => {
  const copy = {
    de: `Dieses Bild auf **/${candidate.pageOrPostSlug}** ändern?\n\nAktuell: ${candidate.label}`,
    en: `Change this image on **/${candidate.pageOrPostSlug}**?\n\nCurrent: ${candidate.label}`,
    es: `¿Cambiar esta imagen en **/${candidate.pageOrPostSlug}**?\n\nActual: ${candidate.label}`,
  } as const;
  const urlLine =
    typeof imageUrl === 'string' && imageUrl.trim().length > 0
      ? `\n${imageUrl.trim()}`
      : '';
  return `${copy[locale]}${urlLine}`;
};

export const buildEditImagePlanMessage = (
  locale: SupportedLocale,
  candidate: ImageEditCandidate,
  contentLocales: readonly SupportedLocale[],
): string => {
  const allLocalesNote =
    contentLocales.length > 1
      ? {
          de: '\n\nHinweis: Das Bild wird in **allen Sprachen** der Site aktualisiert.',
          en: '\n\nNote: the image updates **all site languages**.',
          es: '\n\nNota: la imagen se actualiza en **todos los idiomas** del sitio.',
        }[locale]
      : '';
  const copy = {
    de: `Plan: Bild auf **/${candidate.pageOrPostSlug}** ersetzen (${candidate.label}).`,
    en: `Plan: replace image on **/${candidate.pageOrPostSlug}** (${candidate.label}).`,
    es: `Plan: reemplazar imagen en **/${candidate.pageOrPostSlug}** (${candidate.label}).`,
  } as const;
  return `${copy[locale]}${allLocalesNote}`;
};

export const parseEditImageExecuteInput = (
  projectId: string,
  collect: Extract<EditImageInput, { mode: 'collect' }>,
): Extract<EditImageInput, { mode: 'execute' }> => {
  const parsed = editImageInputSchema.parse({
    mode: 'execute',
    projectId,
    replacementArtifactKey: collect.replacementArtifactKey,
    replacementMime: collect.replacementMime,
    ...(collect.replacementSourceUrl === undefined
      ? {}
      : { replacementSourceUrl: collect.replacementSourceUrl }),
    targetKey: collect.targetKey,
  });
  if (parsed.mode !== 'execute')
    throw new Error('Edit image execute input expected.');
  return parsed;
};

export const resolveEditImageProductionOrigin = (
  manifest: Pick<ProjectManifest, 'deployment'>,
): string => {
  const fromManifest = manifest.deployment?.productionOrigin;
  if (typeof fromManifest === 'string' && fromManifest.trim().length > 0)
    return fromManifest.replace(/\/$/u, '');
  throw new Error('Manifest deployment.productionOrigin is required.');
};

export const buildImagePublicUrl = (
  origin: string,
  path: string,
): string => {
  const base = origin.replace(/\/$/u, '');
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
};

export const editImageNaturalLanguage = (text: string): boolean =>
  /\b(cambi(?:ar|o|ando)\s+(?:la\s+)?(?:imagen|foto|portada)|(?:edit(?:ar)?|change|replace)\s+(?:the\s+)?(?:image|photo|cover|picture)|(?:bild|foto|titelbild)\s+(?:ändern|tauschen|ersetzen)|edit\s+image|change\s+image|replace\s+image|cover\s+(?:image|photo)|portada)\b/iu.test(
    text,
  );

export const formatEditImagePickLabel = (
  locale: SupportedLocale,
  index: number,
  candidate: ImageEditCandidate,
): string => {
  const prefix = editImageActionLabels[locale].pickTarget;
  return `${prefix} ${index + 1}: ${candidate.pageOrPostTitle}`;
};
