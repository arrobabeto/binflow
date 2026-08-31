import {
  type CredentialVerifier,
  type CredentialVerifierInput,
  type VerificationEvidence,
} from '@binflow/integrations';
import { DomainError } from '@binflow/domain';
import { decryptSecret } from '@binflow/secrets';
import { z } from 'zod';

const secretSchema = z
  .object({
    apiKey: z.string().min(8).max(512),
  })
  .strict();

const configurationSchema = z
  .object({
    baseUrl: z.string().url().max(500),
    postsTable: z.string().trim().min(1).max(80).default('posts'),
  })
  .strict();

const mapHttpError = (
  status: number,
  bodyText: string,
  operation: 'verify' | 'mutate',
): DomainError => {
  const detail = bodyText.replace(/\s+/gu, ' ').trim().slice(0, 400);
  if (status === 401 || status === 403 || status === 404) {
    return new DomainError(
      'authentication_error',
      'Orbitype API key was rejected.',
      detail.length === 0 ? {} : { detail },
    );
  }
  // SQL / schema / validation failures must not retry — they caused a
  // GENERATING recovery loop against Bistro when INSERT used the wrong columns.
  if (status >= 400 && status < 500) {
    return new DomainError(
      'provider_final',
      operation === 'verify'
        ? 'Orbitype verification returned an unexpected status.'
        : 'Orbitype rejected the CMS mutation.',
      {
        code:
          operation === 'mutate' ? 'orbitype_draft_failed' : 'orbitype_http_4xx',
        status: String(status),
        ...(detail.length === 0 ? {} : { detail }),
      },
    );
  }
  if (status >= 500) {
    const looksDeterministic =
      /invalid input syntax|does not exist|syntax error|column .* does not exist/iu.test(
        detail,
      );
    return new DomainError(
      looksDeterministic ? 'provider_final' : 'provider_retryable',
      looksDeterministic
        ? 'Orbitype rejected the CMS mutation.'
        : operation === 'verify'
          ? 'Orbitype could not complete verification.'
          : 'Orbitype CMS is temporarily unavailable.',
      {
        ...(looksDeterministic
          ? { code: 'orbitype_draft_failed' }
          : {}),
        status: String(status),
        ...(detail.length === 0 ? {} : { detail }),
      },
    );
  }
  return new DomainError(
    'provider_final',
    'Orbitype returned an unexpected status.',
    {
      status: String(status),
      ...(detail.length === 0 ? {} : { detail }),
    },
  );
};

const postSql = async (
  input: Readonly<{
    apiKey: string;
    baseUrl: string;
    bindings: Record<string, unknown>;
    fetch: typeof globalThis.fetch;
    operation?: 'verify' | 'mutate';
    signal?: AbortSignal;
    sql: string;
  }>,
): Promise<unknown> => {
  const operation = input.operation ?? 'mutate';
  let response: Response;
  try {
    response = await input.fetch(input.baseUrl, {
      body: JSON.stringify({
        bindings: input.bindings,
        sql: input.sql,
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': input.apiKey,
      },
      method: 'POST',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  } catch {
    throw new DomainError(
      'provider_retryable',
      'Orbitype could not be reached.',
    );
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw mapHttpError(response.status, bodyText, operation);
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * Read-only Orbitype SQL API verification (ADR-0045).
 * Probes with `SELECT 1` via X-API-KEY; never mutates CMS content.
 */
export const createOrbitypeCredentialVerifier = (
  options: Readonly<{
    fetch?: typeof globalThis.fetch;
  }> = {},
): CredentialVerifier => ({
  kinds: ['orbitype-api'],
  async verify(input: CredentialVerifierInput): Promise<VerificationEvidence> {
    if (
      input.credential.ownerScope !== 'project' ||
      input.credential.projectId === undefined ||
      input.credential.tenantId === undefined
    ) {
      throw new DomainError(
        'policy_denied',
        'Orbitype credentials must be project-scoped.',
      );
    }

    let configuration: z.infer<typeof configurationSchema>;
    try {
      configuration = configurationSchema.parse(input.credential.configuration);
      if (input.credential.connection?.configuration !== undefined) {
        configurationSchema.parse(input.credential.connection.configuration);
      }
    } catch {
      throw new DomainError(
        'validation_error',
        'Orbitype credential configuration is invalid.',
      );
    }
    if (input.credential.connection?.projectId === undefined) {
      throw new DomainError(
        'validation_error',
        'Orbitype credential is missing its project binding.',
      );
    }

    const plaintext = decryptSecret(
      input.credential.envelope,
      input.masterKey,
      input.credential.secretContext,
    );
    try {
      let secret: z.infer<typeof secretSchema>;
      try {
        secret = secretSchema.parse(JSON.parse(plaintext.toString('utf8')));
      } catch {
        throw new DomainError(
          'validation_error',
          'Orbitype credential payload is invalid.',
        );
      }

      const fetch = options.fetch ?? globalThis.fetch;
      await postSql({
        apiKey: secret.apiKey,
        baseUrl: configuration.baseUrl,
        bindings: {},
        fetch,
        operation: 'verify',
        signal: input.signal,
        sql: 'SELECT 1 AS ok',
      });

      let baseUrlHost: string;
      try {
        baseUrlHost = new URL(configuration.baseUrl).host;
      } catch {
        throw new DomainError(
          'validation_error',
          'Orbitype base URL is invalid.',
        );
      }

      return {
        authenticated: true,
        baseUrlHost,
        externalResourceId: baseUrlHost,
        readOnlyProbe: 'select_1',
      };
    } finally {
      plaintext.fill(0);
    }
  },
});

export type OrbitypeBlogDraftInput = Readonly<{
  body: string;
  category?: string;
  img?: string;
  keywords?: readonly string[];
  lead?: string;
  locale: string;
  requestVersionId: string;
  slug: string;
  title: string;
}>;

export type OrbitypeBlogDraftEvidence = Readonly<{
  draftId: string;
  locale: string;
  slug: string;
}>;

export type OrbitypeBlogPublicationPort = Readonly<{
  createDraft(
    input: OrbitypeBlogDraftInput,
  ): Promise<OrbitypeBlogDraftEvidence>;
  publish(
    input: Readonly<{ draftId: string; requestVersionId: string }>,
  ): Promise<Readonly<{ publishedId: string }>>;
}>;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Minimal markdown → HTML for Bistro SectionPostBody content. */
export const markdownToOrbitypeHtml = (markdown: string): string => {
  const blocks = markdown
    .replaceAll(/\r\n/gu, '\n')
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  const html: string[] = [];
  for (const block of blocks) {
    if (block.startsWith('## ')) {
      html.push(`<h2>${escapeHtml(block.slice(3).trim())}</h2>`);
      continue;
    }
    if (block.startsWith('# ')) {
      html.push(`<h2>${escapeHtml(block.slice(2).trim())}</h2>`);
      continue;
    }
    const withBreaks = escapeHtml(block).replaceAll('\n', '<br />\n');
    html.push(`<p>\n  ${withBreaks}\n</p>`);
  }
  return html.join('\n');
};

const localeRecord = (
  locale: string,
  value: string,
): Record<string, string> => ({ [locale]: value });

const draftPostId = (requestVersionId: string, locale: string): string => {
  const compact = requestVersionId.replaceAll(/[^a-zA-Z0-9]/gu, '');
  const suffix = compact.slice(-8).padStart(8, '0');
  const localeTag = locale.slice(0, 2);
  return `bf${localeTag}${suffix}`.slice(0, 16);
};

const formatGermanDate = (isoDate = new Date()): string =>
  new Intl.DateTimeFormat('de-CH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(isoDate);

const buildPostSections = (
  input: OrbitypeBlogDraftInput,
): ReadonlyArray<Record<string, unknown>> => {
  const locale = input.locale;
  const category = input.category ?? 'Gastronomie';
  const img = input.img ?? '';
  const dateLabel = formatGermanDate();
  const html = markdownToOrbitypeHtml(input.body);
  return [
    {
      _orbi: { component: 'SectionPostHero' },
      author: localeRecord(locale, ''),
      category: localeRecord(locale, category),
      date: localeRecord(locale, dateLabel),
      img,
      imgAlt: localeRecord(locale, input.title),
      readingTime: localeRecord(locale, ''),
      title: localeRecord(locale, input.title),
    },
    {
      _orbi: { component: 'SectionPostBody' },
      category: localeRecord(locale, category),
      content: localeRecord(locale, html),
    },
  ];
};

/**
 * Allowlisted Orbitype blog draft/publish for Bistro-shaped `posts` rows
 * (ADR-0047). Fixed SQL only — never LLM-supplied SQL.
 *
 * Bistro columns: id, title(json), lead(json), img(text), status(json),
 * sections(json), keywords(json), created_at, updated_at.
 */
export const createOrbitypeBlogPublicationPort = (
  options: Readonly<{
    baseUrl: string;
    apiKey: string;
    fetch?: typeof globalThis.fetch;
    postsTable?: string;
  }>,
): OrbitypeBlogPublicationPort => {
  const fetch = options.fetch ?? globalThis.fetch;
  const table = options.postsTable ?? 'posts';
  if (!/^[a-z][a-z0-9_]*$/u.test(table))
    throw new DomainError(
      'validation_error',
      'Orbitype posts table name is invalid.',
    );

  return {
    async createDraft(input) {
      const draftId = draftPostId(input.requestVersionId, input.locale);
      const lead =
        input.lead?.trim() ||
        input.body
          .replaceAll(/^#+\s+/gmu, '')
          .replaceAll(/\s+/gu, ' ')
          .trim()
          .slice(0, 280);
      const status = {
        options: ['draft', 'review', 'published'],
        value: 'draft',
      };
      const title = localeRecord(input.locale, input.title);
      const leadJson = localeRecord(input.locale, lead);
      const sections = buildPostSections(input);
      const keywords = [...(input.keywords ?? [])].slice(0, 12);
      const img = input.img ?? '';

      await postSql({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        bindings: {
          id: draftId,
          img,
          keywords: JSON.stringify(keywords),
          lead: JSON.stringify(leadJson),
          sections: JSON.stringify(sections),
          status: JSON.stringify(status),
          title: JSON.stringify(title),
        },
        fetch,
        operation: 'mutate',
        sql: `INSERT INTO ${table} (id, title, lead, img, status, sections, keywords)
VALUES (
  :id,
  CAST(:title AS json),
  CAST(:lead AS json),
  :img,
  CAST(:status AS json),
  CAST(:sections AS json),
  CAST(:keywords AS json)
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  lead = EXCLUDED.lead,
  img = EXCLUDED.img,
  status = EXCLUDED.status,
  sections = EXCLUDED.sections,
  keywords = EXCLUDED.keywords,
  updated_at = NOW()
RETURNING id`,
      });
      return {
        draftId,
        locale: input.locale,
        slug: input.slug,
      };
    },
    async publish(input) {
      const status = {
        options: ['draft', 'review', 'published'],
        value: 'published',
      };
      await postSql({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        bindings: {
          id: input.draftId,
          status: JSON.stringify(status),
        },
        fetch,
        operation: 'mutate',
        sql: `UPDATE ${table}
SET status = CAST(:status AS json), updated_at = NOW()
WHERE id = :id
RETURNING id`,
      });
      return { publishedId: input.draftId };
    },
  };
};

export type OrbitypePageSnapshot = Readonly<{
  id: string;
  sections: unknown;
  slug: string;
  title: unknown;
}>;

export type OrbitypeMenuPagesPort = Readonly<{
  applySectionPatches(
    input: Readonly<{
      patches: ReadonlyArray<
        Readonly<{ pageId: string; sections: unknown }>
      >;
    }>,
  ): Promise<void>;
  listPages(): Promise<readonly OrbitypePageSnapshot[]>;
}>;

export const createOrbitypeMenuPagesPort = (
  options: Readonly<{
    apiKey: string;
    baseUrl: string;
    fetch?: typeof globalThis.fetch;
    pagesTable?: string;
  }>,
): OrbitypeMenuPagesPort => {
  const fetch = options.fetch ?? globalThis.fetch;
  const table = options.pagesTable ?? 'pages';
  if (!/^[a-z][a-z0-9_]*$/u.test(table))
    throw new DomainError(
      'validation_error',
      'Orbitype pages table name is invalid.',
    );

  return {
    async listPages() {
      const rows = await postSql({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        bindings: {},
        fetch,
        operation: 'mutate',
        sql: `SELECT id, slug, title, sections FROM ${table} ORDER BY slug ASC`,
      });
      if (!Array.isArray(rows))
        throw new DomainError(
          'provider_final',
          'Orbitype pages query returned an unexpected shape.',
          { code: 'orbitype_pages_patch_failed' },
        );
      return rows.flatMap((row) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row))
          return [];
        const record = row as Record<string, unknown>;
        if (
          typeof record.id !== 'string' ||
          typeof record.slug !== 'string'
        )
          return [];
        return [
          {
            id: record.id,
            sections: record.sections,
            slug: record.slug,
            title: record.title,
          },
        ];
      });
    },
    async applySectionPatches(input) {
      for (const patch of input.patches) {
        await postSql({
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          bindings: {
            id: patch.pageId,
            sections: JSON.stringify(patch.sections),
          },
          fetch,
          operation: 'mutate',
          sql: `UPDATE ${table}
SET sections = CAST(:sections AS json), updated_at = NOW()
WHERE id = :id
RETURNING id`,
        });
      }
    },
  };
};

export type OrbitypePostSnapshot = Readonly<{
  id: string;
  img: string;
  sections: unknown;
  title: unknown;
}>;

export type OrbitypeImagesPort = Readonly<{
  applyPageSectionPatches(
    input: Readonly<{
      patches: ReadonlyArray<
        Readonly<{ pageId: string; sections: unknown }>
      >;
    }>,
  ): Promise<void>;
  applyPostPatches(
    input: Readonly<{
      patches: ReadonlyArray<
        Readonly<{
          postId: string;
          img?: string;
          sections?: unknown;
        }>
      >;
    }>,
  ): Promise<void>;
  listPages(): Promise<readonly OrbitypePageSnapshot[]>;
  listPosts(): Promise<readonly OrbitypePostSnapshot[]>;
}>;

export const createOrbitypeImagesPort = (
  options: Readonly<{
    apiKey: string;
    baseUrl: string;
    fetch?: typeof globalThis.fetch;
    pagesTable?: string;
    postsTable?: string;
  }>,
): OrbitypeImagesPort => {
  const fetch = options.fetch ?? globalThis.fetch;
  const pagesTable = options.pagesTable ?? 'pages';
  const postsTable = options.postsTable ?? 'posts';
  if (!/^[a-z][a-z0-9_]*$/u.test(pagesTable))
    throw new DomainError(
      'validation_error',
      'Orbitype pages table name is invalid.',
    );
  if (!/^[a-z][a-z0-9_]*$/u.test(postsTable))
    throw new DomainError(
      'validation_error',
      'Orbitype posts table name is invalid.',
    );

  const pagesPort = createOrbitypeMenuPagesPort({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    fetch,
    pagesTable,
  });

  return {
    listPages: () => pagesPort.listPages(),
    async applyPageSectionPatches(input) {
      await pagesPort.applySectionPatches(input);
    },
    async listPosts() {
      const rows = await postSql({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        bindings: {},
        fetch,
        operation: 'mutate',
        sql: `SELECT id, title, img, sections FROM ${postsTable} ORDER BY id ASC`,
      });
      if (!Array.isArray(rows))
        throw new DomainError(
          'provider_final',
          'Orbitype posts query returned an unexpected shape.',
          { code: 'orbitype_content_patch_failed' },
        );
      return rows.flatMap((row) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row))
          return [];
        const record = row as Record<string, unknown>;
        if (typeof record.id !== 'string') return [];
        return [
          {
            id: record.id,
            img: typeof record.img === 'string' ? record.img : '',
            sections: record.sections,
            title: record.title,
          },
        ];
      });
    },
    async applyPostPatches(input) {
      for (const patch of input.patches) {
        const sets: string[] = ['updated_at = NOW()'];
        const bindings: Record<string, unknown> = { id: patch.postId };
        if (patch.img !== undefined) {
          sets.unshift('img = :img');
          bindings.img = patch.img;
        }
        if (patch.sections !== undefined) {
          sets.unshift('sections = CAST(:sections AS json)');
          bindings.sections = JSON.stringify(patch.sections);
        }
        if (sets.length === 1) continue;
        await postSql({
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          bindings,
          fetch,
          operation: 'mutate',
          sql: `UPDATE ${postsTable}
SET ${sets.join(', ')}
WHERE id = :id
RETURNING id`,
        });
      }
    },
  };
};
