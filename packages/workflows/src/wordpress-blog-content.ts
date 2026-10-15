import type {
  CreateBlogWordpressInput,
  SupportedLocale,
} from '@binflow/contracts';

export const WORDPRESS_AS_IS_MIN_BODY_CHARS = 200;
export const WORDPRESS_GENERATE_MIN_BASE_CHARS = 20;
export const WORDPRESS_CATEGORY_SUGGESTIONS = 6;

type CollectInput = Extract<CreateBlogWordpressInput, { mode: 'collect' }>;

const TITLE_PREFIX = /^(?:t[ií]tulo|title|titel)\s*:\s*(.+)$/iu;

/**
 * As-is articles may carry their own title as a first `# Heading` line or a
 * `Título: …` line. Nothing else is inferred: a missing title is a gap.
 */
export const splitAsIsTitle = (
  content: string,
): Readonly<{ body: string; title?: string }> => {
  const lines = content.replace(/\r\n/gu, '\n').split('\n');
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex === -1) return { body: '' };
  const first = (lines[firstIndex] ?? '').trim();
  const heading = /^#\s+(.+)$/u.exec(first);
  const prefixed = TITLE_PREFIX.exec(first);
  const title = (heading?.[1] ?? prefixed?.[1])?.trim();
  if (title === undefined || title.length < 3 || title.length > 200)
    return { body: content.trim() };
  return {
    body: lines.slice(firstIndex + 1).join('\n').trim(),
    title,
  };
};

export const nextWordpressBlogStep = (
  input: CollectInput,
): CollectInput['collectionStep'] => {
  if (input.blogMode === undefined) return 'choose_mode';
  if (input.blogMode === 'as_is') {
    const { body } = splitAsIsTitle(input.content);
    if (body.length < WORDPRESS_AS_IS_MIN_BODY_CHARS) return 'await_content';
    if (input.title === undefined) return 'await_title';
    if (input.excerpt === undefined && !input.excerptSkipped)
      return 'await_excerpt';
  } else if (input.content.trim().length < WORDPRESS_GENERATE_MIN_BASE_CHARS) {
    return 'await_content';
  }
  if (input.category === undefined) return 'choose_category';
  if (input.image === undefined) return 'choose_image';
  return 'ready';
};

const normalizeTokens = (value: string): readonly string[] =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3);

const UNCATEGORIZED = new Set(['uncategorized', 'sin-categoria', 'allgemein']);

/** Rank existing categories by word overlap with the article, then by size. */
export const suggestWordpressCategories = <
  Category extends Readonly<{ count: number; id: number; name: string; slug: string }>,
>(
  categories: readonly Category[],
  text: string,
  limit = WORDPRESS_CATEGORY_SUGGESTIONS,
): readonly Category[] => {
  const words = new Set(normalizeTokens(text));
  return [...categories]
    .filter((category) => !UNCATEGORIZED.has(category.slug))
    .map((category) => ({
      category,
      score: normalizeTokens(category.name).filter((token) => words.has(token))
        .length,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.category.count - left.category.count ||
        left.category.name.localeCompare(right.category.name),
    )
    .slice(0, limit)
    .map((entry) => entry.category);
};

export const matchExistingCategoryName = <
  Category extends Readonly<{ id: number; name: string }>,
>(
  categories: readonly Category[],
  name: string,
): Category | undefined => {
  const wanted = normalizeTokens(name).join(' ');
  return categories.find(
    (category) => normalizeTokens(category.name).join(' ') === wanted,
  );
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

const inline = (value: string): string =>
  escapeHtml(value).replace(/\*\*(.+?)\*\*/gu, '<strong>$1</strong>');

/**
 * Format the client's text as HTML without changing any word: blank-line
 * paragraphs, `##`/`###` headings, `-`/`*` and `1.` lists, `**bold**`.
 */
export const composeAsIsHtml = (body: string): string =>
  body
    .replace(/\r\n/gu, '\n')
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim());
      const heading = /^(#{2,3})\s+(.+)$/u.exec(block);
      if (lines.length === 1 && heading !== null) {
        const level = heading[1] === '##' ? 'h2' : 'h3';
        return `<${level}>${inline(heading[2] ?? '')}</${level}>`;
      }
      if (lines.every((line) => /^[-*]\s+/u.test(line)))
        return `<ul>${lines
          .map((line) => `<li>${inline(line.replace(/^[-*]\s+/u, ''))}</li>`)
          .join('')}</ul>`;
      if (lines.every((line) => /^\d+[.)]\s+/u.test(line)))
        return `<ol>${lines
          .map((line) => `<li>${inline(line.replace(/^\d+[.)]\s+/u, ''))}</li>`)
          .join('')}</ol>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    })
    .join('\n');

export const isSiteImageUrl = (value: string, siteOrigin: string): boolean => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  const origin = new URL(siteOrigin);
  return (
    url.protocol === origin.protocol &&
    url.host === origin.host &&
    url.username === '' &&
    url.password === ''
  );
};

export const wordpressBlogCopy = {
  de: {
    asIsButton: 'So wie er ist',
    cancel: 'Abbrechen',
    categoryMissing: 'Die gewählte Kategorie existiert nicht mehr. Bitte erneut wählen.',
    chooseCategory: 'Wähle eine Kategorie für den Beitrag oder schlage eine neue vor (braucht Admin-Freigabe).',
    chooseImage:
      'Titelbild: sende ein Foto hier im Chat, füge die URL eines Bildes deiner Website ein oder tippe auf **Mit KI erstellen**.',
    chooseMode:
      'Wie soll der Blogbeitrag entstehen?\n· **So wie er ist**: dein Text wird unverändert veröffentlicht; ich frage nur nach Fehlendem.\n· **Mit Stil generieren**: du gibst die Basisinfos, ich schreibe den Artikel im Stil deiner Marke.',
    confirmPlan: 'Geschützte Vorschau erstellen',
    contentReceived: (chars: number) =>
      `Erhalten (${String(chars)} Zeichen). Sende weiteren Text oder tippe auf **Fertig**.`,
    contentTooShort: (min: number) =>
      `Der Artikeltext ist zu kurz (mind. ${String(min)} Zeichen ohne Titel). Sende den Rest oder tippe danach auf **Fertig**.`,
    done: 'Fertig',
    excerptTooLong: 'Der Auszug darf höchstens 300 Zeichen haben.',
    generateButton: 'Mit Stil generieren',
    guidanceAsIs:
      'Sende den vollständigen Artikel (gern in mehreren Nachrichten). Optional: erste Zeile `# Titel`. Tippe danach auf **Fertig**.',
    guidanceGenerate:
      'Sende die Basisinformationen (Thema, Kernpunkte, Daten, Zielgruppe). Tippe danach auf **Fertig**.',
    imageAi: 'Mit KI erstellen',
    imageRejected:
      'Das Bild muss ein Foto im Chat oder eine Bild-URL deiner eigenen Website sein.',
    newCategory: 'Neue Kategorie',
    newCategoryPrompt: 'Wie soll die neue Kategorie heißen? (2–60 Zeichen, braucht Admin-Freigabe)',
    notEnabled: 'Blogbeiträge sind für dieses Projekt nicht aktiviert.',
    pickButton: 'Nutze die Buttons oben, um fortzufahren.',
    plan: (input: Readonly<{ category: string; image: string; mode: string; title: string }>) =>
      `Plan: Beitrag **${input.title}**\nModus: ${input.mode}\nKategorie: ${input.category}\nBild: ${input.image}\n\nIch erstelle den Beitrag passwortgeschützt auf deiner Website; du bekommst Link und Passwort zur Prüfung.`,
    planImageAi: 'KI-generiert',
    planImageSite: 'Bild deiner Website',
    planImageTelegram: 'dein Foto',
    planModeAsIs: 'so wie er ist',
    planModeGenerate: 'mit Stil generiert',
    planNewCategory: (name: string) => `${name} (neu, Admin-Freigabe)`,
    planTitleGenerated: '(wird generiert)',
    skip: 'Überspringen',
    timeout:
      'Deine WordPress-Website hat nicht rechtzeitig geantwortet. Bitte versuche es gleich noch einmal; es wurde nichts veröffentlicht.',
    titlePrompt: 'Wie lautet der Titel des Beitrags?',
    titleInvalid: 'Der Titel muss 3–200 Zeichen lang sein.',
    excerptPrompt: 'Möchtest du einen kurzen Auszug (max. 300 Zeichen)? Sende ihn oder tippe auf **Überspringen**.',
  },
  en: {
    asIsButton: 'As-is',
    cancel: 'Cancel',
    categoryMissing: 'The chosen category no longer exists. Please pick again.',
    chooseCategory: 'Pick a category for the post or propose a new one (needs admin approval).',
    chooseImage:
      'Featured image: send a photo in this chat, paste the URL of an image from your site, or tap **Generate with AI**.',
    chooseMode:
      'How should the blog post be created?\n· **As-is**: your text is published unchanged; I only ask for what is missing.\n· **Generate with style**: you give the base information and I write the article in your brand style.',
    confirmPlan: 'Create protected preview',
    contentReceived: (chars: number) =>
      `Received (${String(chars)} characters). Send more text or tap **Done**.`,
    contentTooShort: (min: number) =>
      `The article text is too short (at least ${String(min)} characters without the title). Send the rest, then tap **Done**.`,
    done: 'Done',
    excerptTooLong: 'The excerpt must be at most 300 characters.',
    generateButton: 'Generate with style',
    guidanceAsIs:
      'Send the full article (several messages are fine). Optional: first line `# Title`. Then tap **Done**.',
    guidanceGenerate:
      'Send the base information (topic, key points, facts, audience). Then tap **Done**.',
    imageAi: 'Generate with AI',
    imageRejected:
      'The image must be a photo sent in this chat or an image URL from your own site.',
    newCategory: 'New category',
    newCategoryPrompt: 'What should the new category be called? (2–60 characters, needs admin approval)',
    notEnabled: 'Blog posts are not enabled for this project.',
    pickButton: 'Use the buttons above to continue.',
    plan: (input: Readonly<{ category: string; image: string; mode: string; title: string }>) =>
      `Plan: post **${input.title}**\nMode: ${input.mode}\nCategory: ${input.category}\nImage: ${input.image}\n\nI will create the post password-protected on your site; you will get the link and password to review it.`,
    planImageAi: 'AI-generated',
    planImageSite: 'image from your site',
    planImageTelegram: 'your photo',
    planModeAsIs: 'as-is',
    planModeGenerate: 'generated with style',
    planNewCategory: (name: string) => `${name} (new, admin approval)`,
    planTitleGenerated: '(to be generated)',
    skip: 'Skip',
    timeout:
      'Your WordPress site did not respond in time. Please try again shortly; nothing was published.',
    titlePrompt: 'What is the title of the post?',
    titleInvalid: 'The title must be 3–200 characters long.',
    excerptPrompt: 'Do you want a short excerpt (max 300 characters)? Send it or tap **Skip**.',
  },
  es: {
    asIsButton: 'Tal cual',
    cancel: 'Cancelar',
    categoryMissing: 'La categoría elegida ya no existe. Elige otra.',
    chooseCategory: 'Elige una categoría para el post o propón una nueva (requiere aprobación del admin).',
    chooseImage:
      'Imagen destacada: envía una foto en este chat, pega la URL de una imagen de tu sitio o pulsa **Generar con IA**.',
    chooseMode:
      '¿Cómo quieres crear el blog?\n· **Tal cual**: publico tu texto sin cambios; solo te pregunto lo que falte.\n· **Generar con estilo**: me das la información base y escribo el artículo con el estilo de tu marca.',
    confirmPlan: 'Crear vista previa protegida',
    contentReceived: (chars: number) =>
      `Recibido (${String(chars)} caracteres). Envía más texto o pulsa **Listo**.`,
    contentTooShort: (min: number) =>
      `El texto del artículo es muy corto (mínimo ${String(min)} caracteres sin el título). Envía el resto y luego pulsa **Listo**.`,
    done: 'Listo',
    excerptTooLong: 'El extracto debe tener como máximo 300 caracteres.',
    generateButton: 'Generar con estilo',
    guidanceAsIs:
      'Envía el artículo completo (puedes usar varios mensajes). Opcional: primera línea `# Título`. Luego pulsa **Listo**.',
    guidanceGenerate:
      'Envía la información base (tema, puntos clave, datos, público). Luego pulsa **Listo**.',
    imageAi: 'Generar con IA',
    imageRejected:
      'La imagen debe ser una foto enviada en este chat o la URL de una imagen de tu propio sitio.',
    newCategory: 'Nueva categoría',
    newCategoryPrompt: '¿Cómo se llamará la nueva categoría? (2–60 caracteres, requiere aprobación del admin)',
    notEnabled: 'Los posts de blog no están activados para este proyecto.',
    pickButton: 'Usa los botones de arriba para continuar.',
    plan: (input: Readonly<{ category: string; image: string; mode: string; title: string }>) =>
      `Plan: post **${input.title}**\nModo: ${input.mode}\nCategoría: ${input.category}\nImagen: ${input.image}\n\nCrearé el post protegido con contraseña en tu sitio; recibirás el enlace y la contraseña para revisarlo.`,
    planImageAi: 'generada con IA',
    planImageSite: 'imagen de tu sitio',
    planImageTelegram: 'tu foto',
    planModeAsIs: 'tal cual',
    planModeGenerate: 'generado con estilo',
    planNewCategory: (name: string) => `${name} (nueva, aprobación admin)`,
    planTitleGenerated: '(se generará)',
    skip: 'Omitir',
    timeout:
      'Tu sitio WordPress no respondió a tiempo. Inténtalo de nuevo en un momento; no se publicó nada.',
    titlePrompt: '¿Cuál es el título del post?',
    titleInvalid: 'El título debe tener entre 3 y 200 caracteres.',
    excerptPrompt: '¿Quieres un extracto corto (máx. 300 caracteres)? Envíalo o pulsa **Omitir**.',
  },
} as const satisfies Record<SupportedLocale, unknown>;
