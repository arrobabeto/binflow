import { and, eq, gte } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { createOpenAIWordpressBlogGenerationPort } from '@binflow/ai';
import type { ArtifactStore } from '@binflow/artifacts';
import {
  wordpressRestManifestSchema,
  type SupportedLocale,
  type WordpressRestManifest,
  type workflowResumeSignalSchema,
} from '@binflow/contracts';
import {
  getCredentialForVerification,
  recordProcessedEvent,
  schema,
  withPlatformSystemScope,
  withSystemTenantScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError } from '@binflow/domain';
import {
  renderWordpressPreviewNotice,
  renderWordpressPublishedNotice,
  type TelegramRuntime,
} from '@binflow/messaging';
import { decryptSecret } from '@binflow/secrets';
import { createWordpressBlogPublicationPort } from '@binflow/wordpress';
import {
  WORDPRESS_BLOG_CAPABILITY_ID,
  WordpressBlogWorkflowRuntime,
  wordpressBlogCopy,
  type WordpressBlogCatalogLoader,
  type WordpressPreviewResult,
} from '@binflow/workflows';

type ResumeSignal = ReturnType<typeof workflowResumeSignalSchema.parse>;
type Credential = NonNullable<Awaited<ReturnType<typeof getCredentialForVerification>>>;
type TelegramMessage = Parameters<TelegramRuntime['adapter']['postMessage']>[1];

export type WordpressBlogJobDeps = Readonly<{
  artifactStore: ArtifactStore;
  database: Database;
  loadMasterKey: () => Promise<Buffer>;
  notifyClient: (requestId: string, message: TelegramMessage) => Promise<void>;
  resolveLocale: (requestId: string) => Promise<SupportedLocale>;
}>;

const loadWordpressCredential = async (
  scoped: ScopedDatabase,
  projectId: string,
): Promise<Credential> => {
  const [row] = await scoped
    .select({ id: schema.providerCredentials.id })
    .from(schema.providerCredentials)
    .where(
      and(
        eq(schema.providerCredentials.kind, 'wordpress-api'),
        eq(schema.providerCredentials.status, 'active'),
        eq(schema.providerCredentials.projectId, projectId),
      ),
    )
    .limit(1);
  const credential =
    row === undefined ? undefined : await getCredentialForVerification(scoped, row.id);
  if (credential?.projectId !== projectId)
    throw new DomainError(
      'credential_unavailable',
      'Active WordPress credential is unavailable for this project.',
      { code: 'wordpress_credential_missing' },
    );
  return credential;
};

/** Application password stays in this closure only; the decrypted buffer is zeroed. */
const createPublicationPort = (
  credential: Credential,
  manifest: WordpressRestManifest,
  masterKey: Buffer,
) => {
  const plaintext = decryptSecret(credential.envelope, masterKey, credential.secretContext);
  try {
    const secret = JSON.parse(plaintext.toString('utf8')) as { applicationPassword?: unknown };
    if (typeof secret.applicationPassword !== 'string')
      throw new DomainError(
        'credential_unavailable',
        'WordPress application password is missing.',
        { code: 'wordpress_credential_missing' },
      );
    return createWordpressBlogPublicationPort({
      applicationPassword: secret.applicationPassword,
      restBase: manifest.wordpress.restBase,
      siteOrigin: manifest.wordpress.siteOrigin,
      userId: manifest.wordpress.userId,
      username: manifest.wordpress.username,
    });
  } finally {
    plaintext.fill(0);
  }
};

const loadJobContext = async (database: Database, signal: ResumeSignal) =>
  withPlatformSystemScope(database, 'create_blog_wordpress.load_context', async (scoped) => {
    const [row] = await scoped
      .select({
        document: schema.projectManifestVersions.document,
        projectId: schema.requests.projectId,
      })
      .from(schema.requests)
      .innerJoin(
        schema.requestVersions,
        and(
          eq(schema.requestVersions.id, signal.requestVersionId),
          eq(schema.requestVersions.requestId, schema.requests.id),
        ),
      )
      .innerJoin(
        schema.projectManifestVersions,
        eq(schema.projectManifestVersions.id, schema.requestVersions.manifestVersionId),
      )
      .where(eq(schema.requests.id, signal.requestId))
      .limit(1);
    if (row === undefined)
      throw new DomainError('validation_error', 'WordPress blog request context is missing.');
    const manifest = wordpressRestManifestSchema.parse(row.document);
    const wordpress = await loadWordpressCredential(scoped, row.projectId);
    const [openaiRow] = await scoped
      .select({ id: schema.providerCredentials.id })
      .from(schema.providerCredentials)
      .where(
        and(
          eq(schema.providerCredentials.kind, 'openai'),
          eq(schema.providerCredentials.status, 'active'),
          eq(schema.providerCredentials.tenantId, signal.tenantId),
        ),
      )
      .limit(1);
    const openai =
      openaiRow === undefined
        ? undefined
        : await getCredentialForVerification(scoped, openaiRow.id);
    if (openai?.tenantId !== signal.tenantId)
      throw new DomainError(
        'credential_unavailable',
        'Active OpenAI credential is unavailable for this tenant.',
      );
    return { manifest, openai, projectId: row.projectId, wordpress };
  });

/** Same daily + per-request budget gates as the GitHub-backed runtimes. */
const createBudgetGuard = async (
  database: Database,
  signal: ResumeSignal,
  manifest: WordpressRestManifest,
  projectId: string,
) => {
  const budget = manifest.budgetPolicy;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const daily = await withSystemTenantScope(
    database,
    { operation: 'create_blog_wordpress.daily_budget', tenantId: signal.tenantId },
    async (scoped) => ({
      requests: await scoped
        .select({ id: schema.requests.id })
        .from(schema.requests)
        .where(
          and(eq(schema.requests.projectId, projectId), gte(schema.requests.createdAt, startOfDay)),
        ),
      usage: await scoped
        .select({ estimatedCostCents: schema.usageRecords.estimatedCostCents })
        .from(schema.usageRecords)
        .where(
          and(
            eq(schema.usageRecords.projectId, projectId),
            gte(schema.usageRecords.createdAt, startOfDay),
          ),
        ),
    }),
  );
  if (
    daily.requests.length > budget.maxRequestsPerDay ||
    daily.usage.reduce((total, record) => total + record.estimatedCostCents, 0) >=
      budget.maxEstimatedCostCentsPerDay
  )
    throw new DomainError('budget_exceeded', 'Project daily budget is exhausted.');

  return async (evidence: {
    estimatedCostCents: number;
    inputTokens: number;
    latencyMs: number;
    model: string;
    outputTokens: number;
    providerRequestId?: string;
  }): Promise<void> => {
    await withSystemTenantScope(
      database,
      { operation: 'create_blog_wordpress.record_model_call', tenantId: signal.tenantId },
      async (scoped) => {
        const calls = await scoped
          .select()
          .from(schema.modelCalls)
          .where(eq(schema.modelCalls.requestVersionId, signal.requestVersionId));
        const nextTokens =
          calls.reduce((total, call) => total + call.inputTokens + call.outputTokens, 0) +
          evidence.inputTokens +
          evidence.outputTokens;
        const nextCost =
          calls.reduce((total, call) => total + call.estimatedCostCents, 0) +
          evidence.estimatedCostCents;
        if (
          calls.length + 1 > budget.maxModelCallsPerRequest ||
          nextTokens > budget.maxTokensPerRequest ||
          nextCost > budget.maxEstimatedCostCentsPerRequest
        )
          throw new DomainError('budget_exceeded', 'Project request budget was exceeded.');
        await scoped.insert(schema.modelCalls).values({
          estimatedCostCents: evidence.estimatedCostCents,
          id: uuidv7(),
          inputHash: signal.requestVersionId,
          inputTokens: evidence.inputTokens,
          latencyMs: evidence.latencyMs,
          model: evidence.model,
          node:
            evidence.model === 'gpt-image-2'
              ? 'prepare_image'
              : signal.reason === 'apply_revision'
                ? 'apply_revision'
                : 'generate',
          outputTokens: evidence.outputTokens,
          projectId,
          provider: 'openai',
          ...(evidence.providerRequestId === undefined
            ? {}
            : { providerRequestId: evidence.providerRequestId }),
          requestId: signal.requestId,
          requestVersionId: signal.requestVersionId,
          status: 'completed',
          tenantId: signal.tenantId,
        });
      },
    );
  };
};

const previewMessage = (
  locale: SupportedLocale,
  preview: WordpressPreviewResult,
  reopened = false,
): TelegramMessage =>
  renderWordpressPreviewNotice({
    link: preview.link,
    locale,
    password: preview.password,
    ...(reopened ? { reopened: true } : {}),
    title: preview.title,
    tokens: preview.actions,
  });

const dispatch = async (
  runtime: WordpressBlogWorkflowRuntime,
  signal: ResumeSignal,
  locale: SupportedLocale,
  deps: WordpressBlogJobDeps,
): Promise<void> => {
  if (signal.reason === 'execute') {
    await deps.notifyClient(signal.requestId, previewMessage(locale, await runtime.execute(signal)));
  } else if (signal.reason === 'apply_revision') {
    await deps.notifyClient(
      signal.requestId,
      previewMessage(locale, await runtime.applyRevision(signal)),
    );
  } else if (signal.reason === 'publish') {
    const result = await runtime.publish(signal);
    await deps.notifyClient(
      signal.requestId,
      result.kind === 'published'
        ? renderWordpressPublishedNotice({ link: result.link, locale })
        : previewMessage(locale, result.preview, true),
    );
  } else if (signal.reason === 'discard_wordpress_post') {
    await runtime.discard(signal);
  } else {
    throw new DomainError(
      'validation_error',
      `create_blog_wordpress does not handle ${signal.reason} jobs.`,
    );
  }
};

export const isWordpressBlogSignal = async (
  database: Database,
  signal: ResumeSignal,
): Promise<boolean> =>
  withPlatformSystemScope(database, 'create_blog_wordpress.route', async (scoped) => {
    const [row] = await scoped
      .select({ capabilityId: schema.requests.capabilityId })
      .from(schema.requests)
      .where(eq(schema.requests.id, signal.requestId))
      .limit(1);
    return row?.capabilityId === WORDPRESS_BLOG_CAPABILITY_ID;
  });

export const processWordpressBlogJob = async (
  deps: WordpressBlogJobDeps,
  signal: ResumeSignal,
) => {
  const context = await loadJobContext(deps.database, signal);
  const masterKey = await deps.loadMasterKey();
  try {
    const port = createPublicationPort(context.wordpress, context.manifest, masterKey);
    const recordModelCall =
      signal.reason === 'execute' || signal.reason === 'apply_revision'
        ? await createBudgetGuard(deps.database, signal, context.manifest, context.projectId)
        : undefined;
    const generation = createOpenAIWordpressBlogGenerationPort({
      credential: context.openai,
      masterKey,
      ...(recordModelCall === undefined ? {} : { onModelCall: recordModelCall }),
    });
    const runtime = new WordpressBlogWorkflowRuntime(
      deps.database,
      deps.artifactStore,
      port,
      generation,
    );
    const locale = await deps.resolveLocale(signal.requestId);
    try {
      await dispatch(runtime, signal, locale, deps);
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.category === 'provider_retryable' &&
        (error.metadata.code === 'wordpress_timeout' ||
          error.metadata.code === 'wordpress_unavailable') &&
        signal.reason !== 'discard_wordpress_post'
      )
        await deps.notifyClient(signal.requestId, {
          markdown: wordpressBlogCopy[locale].timeout,
        });
      throw error;
    }
    return await withSystemTenantScope(
      deps.database,
      { operation: 'create_blog_wordpress.record_completion', tenantId: signal.tenantId },
      async (scoped) => {
        const outcome = await recordProcessedEvent(scoped, {
          consumer: `wordpress-blog-executor-v1:${signal.reason}`,
          eventKey: signal.requestVersionId,
          result: { state: 'completed' },
          tenantId: signal.tenantId,
        });
        if (signal.reason !== 'execute' && signal.reason !== 'apply_revision') return outcome;
        const calls = await scoped
          .select()
          .from(schema.modelCalls)
          .where(eq(schema.modelCalls.requestVersionId, signal.requestVersionId));
        await scoped
          .insert(schema.usageRecords)
          .values({
            capabilityId: WORDPRESS_BLOG_CAPABILITY_ID,
            estimatedCostCents: calls.reduce((total, call) => total + call.estimatedCostCents, 0),
            id: uuidv7(),
            modelCalls: calls.length,
            projectId: context.projectId,
            requestId: signal.requestId,
            requestVersionId: signal.requestVersionId,
            tenantId: signal.tenantId,
            tokens: calls.reduce((total, call) => total + call.inputTokens + call.outputTokens, 0),
          })
          .onConflictDoNothing();
        return outcome;
      },
    );
  } finally {
    masterKey.fill(0);
  }
};

/** Category list for `/create_blog` collection (read-only REST call). */
export const createWordpressBlogCatalogLoader =
  (deps: Pick<WordpressBlogJobDeps, 'database' | 'loadMasterKey'>): WordpressBlogCatalogLoader =>
  async ({ manifest, projectId }) => {
    const credential = await withPlatformSystemScope(
      deps.database,
      'create_blog_wordpress.catalog_credential',
      async (scoped) => loadWordpressCredential(scoped, projectId),
    );
    const masterKey = await deps.loadMasterKey();
    try {
      return await createPublicationPort(credential, manifest, masterKey).listCategories();
    } finally {
      masterKey.fill(0);
    }
  };
