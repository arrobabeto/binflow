import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';

import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { Redis } from 'ioredis';
import pino from 'pino';
import { v7 as uuidv7 } from 'uuid';

import { workflowResumeSignalSchema } from '@binflow/contracts';
import { createOpenAIBlogGenerationPort, createOpenAIProjectGenerationPort } from '@binflow/ai';
import { S3ArtifactStore } from '@binflow/artifacts';
import { BlogExecutor, DeleteBlogExecutor } from '@binflow/blog';
import { DeleteProjectExecutor, ProjectExecutor, type RepositoryPublicationPort as ProjectRepositoryPort } from '@binflow/projects';
import {
  createDatabase,
  getCredentialForVerification,
  recordProcessedEvent,
  schema,
  withPlatformSystemScope,
  withSystemTenantScope,
} from '@binflow/db';
import {
  createGitHubContentCatalogPort,
  createGitHubRepositoryPublicationPort,
} from '@binflow/github';
import { DomainError, systemClock } from '@binflow/domain';
import {
  createTelegramRuntime,
  registerAdminTelegramHandlers,
  registerClientTelegramHandlers,
  TelegramPollingLock,
  renderDeleteAdminPendingNotice,
  renderDeletePublicationCompleteNotice,
  renderPreviewReadyNotice,
  renderPublicationCompleteNotice,
  renderRevisionPlanNotice,
  type TelegramRuntime,
} from '@binflow/messaging';
import {
  decryptSecret,
  defaultMasterKeyPath,
  loadRuntimeMasterKeyFile,
} from '@binflow/secrets';
import { createVercelDeploymentPort } from '@binflow/vercel';
import {
  BlogWorkflowRuntime,
  DeleteBlogWorkflowRuntime,
  DeleteProjectWorkflowRuntime,
  ProjectWorkflowRuntime,
  WorkflowService,
  filterBlogCatalogItems,
  filterPortfolioCatalogItems,
  persistDeleteBlogCatalogSync,
  persistDeleteProjectCatalogSync,
  resolveBundleTitle,
  resolveCapabilityRuntime,
  type DeleteBlogCatalogLoader,
  type DeleteProjectCatalogLoader,
} from '@binflow/workflows';

const catalogContentKinds = (
  kind: ReturnType<typeof resolveCapabilityRuntime>['kind'],
): readonly ('blog' | 'portfolio')[] => {
  switch (kind) {
    case 'blog':
    case 'delete_blog':
      return ['blog'];
    case 'project':
    case 'delete_project':
      return ['portfolio'];
  }
};

const deleteNoticeContentKind = (
  kind: ReturnType<typeof resolveCapabilityRuntime>['kind'],
): 'blog' | 'portfolio' =>
  kind === 'delete_project' ? 'portfolio' : 'blog';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const readConfiguredValue = async (
  directName: string,
  fileName: string,
  fallback?: string,
): Promise<string> => {
  const direct = process.env[directName];
  if (direct !== undefined) return direct;
  const path = process.env[fileName];
  if (path !== undefined) return (await readFile(path, 'utf8')).trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`${directName} or ${fileName} is required.`);
};

const redisUrl = await readConfiguredValue(
  'REDIS_URL',
  'REDIS_URL_FILE',
  'redis://localhost:6379',
);
const databaseUrl = await readConfiguredValue(
  'DATABASE_URL',
  'DATABASE_URL_FILE',
  'postgresql://binflow:binflow_local@localhost:5432/binflow',
);
const { db: database, pool } = createDatabase(databaseUrl);

const loadDeleteBlogCatalog: DeleteBlogCatalogLoader = async ({
  database: scoped,
  manifest,
  projectId,
  tenantId,
}) => {
  const masterKey = await loadRuntimeMasterKeyFile(defaultMasterKeyPath());
  try {
    const [githubRow] = await scoped
      .select({
        evidence: schema.providerCredentials.verificationEvidence,
        id: schema.providerCredentials.id,
      })
      .from(schema.providerCredentials)
      .where(
        and(
          eq(schema.providerCredentials.kind, 'github-app'),
          eq(schema.providerCredentials.status, 'active'),
        ),
      )
      .limit(1);
    if (githubRow === undefined)
      throw new DomainError(
        'credential_unavailable',
        'GitHub catalog credential is unavailable.',
      );
    const github = await getCredentialForVerification(scoped, githubRow.id);
    if (github === undefined)
      throw new DomainError(
        'credential_unavailable',
        'GitHub catalog credential material is unavailable.',
      );
    const githubEvidence = githubRow.evidence as {
      installationId?: unknown;
      repositoryId?: unknown;
    } | null;
    if (
      typeof githubEvidence?.installationId !== 'string' ||
      typeof githubEvidence?.repositoryId !== 'string'
    )
      throw new DomainError(
        'credential_unavailable',
        'Verified GitHub installation evidence is unavailable.',
      );
    const catalogPort = createGitHubContentCatalogPort({
      contentKinds: ['blog'],
      credential: github,
      installationId: githubEvidence.installationId,
      masterKey,
      repositoryId: githubEvidence.repositoryId,
    });
    const synchronized = await catalogPort.sync({ manifest });
    await persistDeleteBlogCatalogSync(scoped, {
      items: synchronized.items,
      manifest,
      projectId,
      revision: synchronized.revision,
      tenantId,
    });
    return filterBlogCatalogItems(synchronized.items, manifest);
  } finally {
    masterKey.fill(0);
  }
};

const loadDeleteProjectCatalog: DeleteProjectCatalogLoader = async ({
  database: scoped,
  manifest,
  projectId,
  tenantId,
}) => {
  const masterKey = await loadRuntimeMasterKeyFile(defaultMasterKeyPath());
  try {
    const [githubRow] = await scoped
      .select({
        evidence: schema.providerCredentials.verificationEvidence,
        id: schema.providerCredentials.id,
      })
      .from(schema.providerCredentials)
      .where(
        and(
          eq(schema.providerCredentials.kind, 'github-app'),
          eq(schema.providerCredentials.status, 'active'),
        ),
      )
      .limit(1);
    if (githubRow === undefined)
      throw new DomainError(
        'credential_unavailable',
        'GitHub catalog credential is unavailable.',
      );
    const github = await getCredentialForVerification(scoped, githubRow.id);
    if (github === undefined)
      throw new DomainError(
        'credential_unavailable',
        'GitHub catalog credential material is unavailable.',
      );
    const githubEvidence = githubRow.evidence as {
      installationId?: unknown;
      repositoryId?: unknown;
    } | null;
    if (
      typeof githubEvidence?.installationId !== 'string' ||
      typeof githubEvidence?.repositoryId !== 'string'
    )
      throw new DomainError(
        'credential_unavailable',
        'Verified GitHub installation evidence is unavailable.',
      );
    const catalogPort = createGitHubContentCatalogPort({
      contentKinds: ['portfolio'],
      credential: github,
      installationId: githubEvidence.installationId,
      masterKey,
      repositoryId: githubEvidence.repositoryId,
    });
    const synchronized = await catalogPort.sync({ manifest });
    await persistDeleteProjectCatalogSync(scoped, {
      items: synchronized.items,
      manifest,
      projectId,
      revision: synchronized.revision,
      tenantId,
    });
    return filterPortfolioCatalogItems(synchronized.items, manifest);
  } finally {
    masterKey.fill(0);
  }
};

const workflowService = new WorkflowService(
  database,
  systemClock,
  loadDeleteBlogCatalog,
  loadDeleteProjectCatalog,
);
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const telegramPollingLock = new TelegramPollingLock(
  connection,
  `${process.pid}@${hostname()}`,
  15_000,
);
const queue = new Queue('binflow-workflows', { connection });

const s3AccessKeyId = await readConfiguredValue(
  'S3_ACCESS_KEY_ID',
  'S3_ACCESS_KEY_ID_FILE',
  'binflow',
);
const s3SecretAccessKey = await readConfiguredValue(
  'S3_SECRET_ACCESS_KEY',
  'S3_SECRET_ACCESS_KEY_FILE',
  'binflow_local_storage',
);
const artifactStore = new S3ArtifactStore(
  process.env.BINFLOW_ARTIFACT_BUCKET ?? 'binflow-artifacts',
  {
    accessKeyId: s3AccessKeyId,
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    secretAccessKey: s3SecretAccessKey,
  },
);
const clientTelegramRuntimes = new Map<string, TelegramRuntime>();
const adminTelegramRuntimes = new Map<string, TelegramRuntime>();

const loadExecutionContext = async (
  signal: ReturnType<typeof workflowResumeSignalSchema.parse>,
) =>
  withPlatformSystemScope(
    database,
    'workflow.load_execution_credentials',
    async (scoped) => {
      const [request] = await scoped
        .select({
          capabilityId: schema.requests.capabilityId,
          projectId: schema.requests.projectId,
        })
        .from(schema.requests)
        .where(eq(schema.requests.id, signal.requestId))
        .limit(1);
      if (request === undefined)
        throw new Error('Workflow request is missing.');
      const [budget] = await scoped
        .select()
        .from(schema.projectBudgetPolicies)
        .where(eq(schema.projectBudgetPolicies.projectId, request.projectId))
        .orderBy(desc(schema.projectBudgetPolicies.createdAt))
        .limit(1);
      if (budget === undefined)
        throw new Error('Frozen project budget policy is unavailable.');
      const rows = await scoped
        .select({
          evidence: schema.providerCredentials.verificationEvidence,
          id: schema.providerCredentials.id,
          kind: schema.providerCredentials.kind,
          projectId: schema.providerCredentials.projectId,
          tenantId: schema.providerCredentials.tenantId,
        })
        .from(schema.providerCredentials)
        .where(
          and(
            inArray(schema.providerCredentials.kind, [
              'openai',
              'github-app',
              'vercel',
            ]),
            eq(schema.providerCredentials.status, 'active'),
          ),
        );
      const openaiRow = rows.find(
        (row) => row.kind === 'openai' && row.tenantId === signal.tenantId,
      );
      const githubRow = rows.find((row) => row.kind === 'github-app');
      const vercelRow = rows.find(
        (row) => row.kind === 'vercel' && row.projectId === request.projectId,
      );
      if (
        openaiRow === undefined ||
        githubRow === undefined ||
        vercelRow === undefined
      )
        throw new Error('Active execution credentials are incomplete.');
      const [openai, github, vercel] = await Promise.all([
        getCredentialForVerification(scoped, openaiRow.id),
        getCredentialForVerification(scoped, githubRow.id),
        getCredentialForVerification(scoped, vercelRow.id),
      ]);
      if (openai === undefined || github === undefined || vercel === undefined)
        throw new Error('Execution credential material is unavailable.');
      if (
        openai.tenantId !== signal.tenantId ||
        vercel.projectId !== request.projectId
      )
        throw new Error(
          'Execution credentials do not match the request scope.',
        );
      const githubEvidence = githubRow.evidence as {
        installationId?: unknown;
        repositoryId?: unknown;
      } | null;
      if (
        typeof githubEvidence?.installationId !== 'string' ||
        typeof githubEvidence.repositoryId !== 'string'
      )
        throw new Error(
          'Verified GitHub installation evidence is unavailable.',
        );
      return {
        capabilityId: request.capabilityId,
        github,
        installationId: githubEvidence.installationId,
        openai,
        budget,
        projectId: request.projectId,
        repositoryId: githubEvidence.repositoryId,
        vercel,
      };
    },
  );

const loadClientNotificationTarget = async (requestId: string) =>
  withPlatformSystemScope(
    database,
    'workflow.resolve_client_notification',
    async (scoped) => {
      const [row] = await scoped
        .select({
          botId: schema.channelIdentities.botId,
          chatId: schema.channelIdentities.chatId,
          locale: schema.conversations.locale,
        })
        .from(schema.requests)
        .innerJoin(
          schema.channelIdentities,
          eq(schema.channelIdentities.userId, schema.requests.userId),
        )
        .innerJoin(
          schema.conversations,
          and(
            eq(
              schema.conversations.channelIdentityId,
              schema.channelIdentities.id,
            ),
            eq(
              schema.conversations.externalChatId,
              schema.channelIdentities.chatId,
            ),
          ),
        )
        .where(eq(schema.requests.id, requestId))
        .limit(1);
      return row;
    },
  );

const notifyClient = async (
  requestId: string,
  message: Parameters<TelegramRuntime['adapter']['postMessage']>[1],
): Promise<void> => {
  const target = await loadClientNotificationTarget(requestId);
  if (target === undefined) return;
  const runtime = clientTelegramRuntimes.get(target.botId);
  if (runtime === undefined) return;
  await runtime.adapter.postMessage(`telegram:${target.chatId}`, message);
};

const processWorkflowJob = async (name: string, data: unknown) => {
  if (name !== 'workflow.resume')
    throw new Error(`Unsupported workflow job: ${name}`);
  if (process.env.BINFLOW_LIVE_EXECUTION_ENABLED !== 'true')
    throw new Error(
      'Live workflow execution is disabled. Set BINFLOW_LIVE_EXECUTION_ENABLED=true explicitly.',
    );
  const signal = workflowResumeSignalSchema.parse(data);
  const context = await loadExecutionContext(signal);
  const masterKey = await loadRuntimeMasterKeyFile(
    process.env.BINFLOW_KEK_FILE ?? defaultMasterKeyPath(),
  );
  try {
    await artifactStore.ensureBucket();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const daily = await withSystemTenantScope(
      database,
      { operation: 'workflow.enforce_daily_budget', tenantId: signal.tenantId },
      async (scoped) => ({
        requests: await scoped
          .select({ id: schema.requests.id })
          .from(schema.requests)
          .where(
            and(
              eq(schema.requests.projectId, context.projectId),
              gte(schema.requests.createdAt, startOfDay),
            ),
          ),
        usage: await scoped
          .select()
          .from(schema.usageRecords)
          .where(
            and(
              eq(schema.usageRecords.projectId, context.projectId),
              gte(schema.usageRecords.createdAt, startOfDay),
            ),
          ),
      }),
    );
    if (
      daily.requests.length > context.budget.maxRequestsPerDay ||
      daily.usage.reduce(
        (total, record) => total + record.estimatedCostCents,
        0,
      ) >= context.budget.maxEstimatedCostCentsPerDay
    )
      throw new DomainError(
        'budget_exceeded',
        'Project daily budget is exhausted.',
      );
    const recordModelCall = async (evidence: {
      estimatedCostCents: number;
      inputTokens: number;
      latencyMs: number;
      model: string;
      outputTokens: number;
      providerRequestId?: string;
    }): Promise<void> => {
      await withSystemTenantScope(
        database,
        {
          operation: 'workflow.record_model_call',
          tenantId: signal.tenantId,
        },
        async (scoped) => {
          const calls = await scoped
            .select()
            .from(schema.modelCalls)
            .where(
              eq(schema.modelCalls.requestVersionId, signal.requestVersionId),
            );
          const nextTokens =
            calls.reduce(
              (total, call) => total + call.inputTokens + call.outputTokens,
              0,
            ) +
            evidence.inputTokens +
            evidence.outputTokens;
          const nextCost =
            calls.reduce(
              (total, call) => total + call.estimatedCostCents,
              0,
            ) + evidence.estimatedCostCents;
          if (
            calls.length + 1 > context.budget.maxModelCallsPerRequest ||
            nextTokens > context.budget.maxTokensPerRequest ||
            nextCost > context.budget.maxEstimatedCostCentsPerRequest
          )
            throw new DomainError(
              'budget_exceeded',
              'Project request budget was exceeded.',
            );
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
                : evidence.model === 'text-embedding-3-small'
                  ? 'similarity'
                  : 'generate',
            outputTokens: evidence.outputTokens,
            projectId: context.projectId,
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
    const capabilityRuntime = resolveCapabilityRuntime(context.capabilityId);
    const catalog = createGitHubContentCatalogPort({
      contentKinds: catalogContentKinds(capabilityRuntime.kind),
      credential: context.github,
      installationId: context.installationId,
      masterKey,
      repositoryId: context.repositoryId,
    });
    const repository = createGitHubRepositoryPublicationPort({
      credential: context.github,
      installationId: context.installationId,
      masterKey,
      repositoryId: context.repositoryId,
    });
    const deployments = createVercelDeploymentPort({
      credential: context.vercel,
      masterKey,
    });
    const runtime =
      capabilityRuntime.kind === 'project'
        ? new ProjectWorkflowRuntime(
            database,
            artifactStore,
            new ProjectExecutor(
              catalog,
              createOpenAIProjectGenerationPort({
                capabilityId: context.capabilityId,
                credential: context.openai,
                masterKey,
                onModelCall: recordModelCall,
              }),
              repository as ProjectRepositoryPort,
              deployments,
            ),
          )
        : capabilityRuntime.kind === 'delete_project'
          ? new DeleteProjectWorkflowRuntime(
              database,
              artifactStore,
              new DeleteProjectExecutor(
                catalog,
                repository as ProjectRepositoryPort,
                deployments,
              ),
            )
          : capabilityRuntime.kind === 'delete_blog'
            ? new DeleteBlogWorkflowRuntime(
                database,
                artifactStore,
                new DeleteBlogExecutor(catalog, repository, deployments),
              )
            : new BlogWorkflowRuntime(
                database,
                artifactStore,
                new BlogExecutor(
                  catalog,
                  createOpenAIBlogGenerationPort({
                    capabilityId: context.capabilityId,
                    credential: context.openai,
                    masterKey,
                    onModelCall: recordModelCall,
                  }),
                  repository,
                  deployments,
                ),
              );
    const notificationTarget = await loadClientNotificationTarget(
      signal.requestId,
    );
    const locale =
      notificationTarget?.locale === 'en' ||
      notificationTarget?.locale === 'de' ||
      notificationTarget?.locale === 'es'
        ? notificationTarget.locale
        : 'es';
    if (signal.reason === 'execute') {
      if (
        capabilityRuntime.kind === 'delete_blog' ||
        capabilityRuntime.kind === 'delete_project'
      ) {
        const deleteResult = await (
          runtime as DeleteBlogWorkflowRuntime | DeleteProjectWorkflowRuntime
        ).execute(signal);
        await notifyClient(
          signal.requestId,
          renderDeleteAdminPendingNotice({
            contentKind: deleteNoticeContentKind(capabilityRuntime.kind),
            locale,
            title: deleteResult.result.resolvedTitle,
          }),
        );
      } else {
        const result = await (
          runtime as BlogWorkflowRuntime | ProjectWorkflowRuntime
        ).execute(signal);
        await notifyClient(
          signal.requestId,
          renderPreviewReadyNotice({
            locale,
            title: resolveBundleTitle(capabilityRuntime, result.result.bundle),
            tokens: {
              approve: result.actions.approve,
              cancel: result.actions.cancel,
              revise: result.actions.revise,
            },
            urls: result.result.deployment.urls,
          }),
        );
      }
    } else if (signal.reason === 'interpret_revision') {
      const revisionRuntime = runtime as
        | BlogWorkflowRuntime
        | ProjectWorkflowRuntime;
      const result = await revisionRuntime.interpretRevision(signal);
      await notifyClient(
        signal.requestId,
        renderRevisionPlanNotice({
          locale,
          summary: result.plan.summary,
          tokens: {
            adjust: result.actions.adjust,
            cancel: result.actions.cancel,
            confirm: result.actions.confirm,
          },
        }),
      );
    } else if (signal.reason === 'apply_revision') {
      const revisionRuntime = runtime as
        | BlogWorkflowRuntime
        | ProjectWorkflowRuntime;
      const result = await revisionRuntime.applyRevision(signal);
      await notifyClient(
        signal.requestId,
        renderPreviewReadyNotice({
          locale,
          title: resolveBundleTitle(capabilityRuntime, { es: result.bundle.es }),
          tokens: {
            approve: result.actions.approve,
            cancel: result.actions.cancel,
            revise: result.actions.revise,
          },
          urls: result.deployment.urls,
        }),
      );
    } else if (signal.reason === 'publish') {
      if (
        capabilityRuntime.kind === 'delete_blog' ||
        capabilityRuntime.kind === 'delete_project'
      ) {
        const deletePublished = await (
          runtime as DeleteBlogWorkflowRuntime | DeleteProjectWorkflowRuntime
        ).publish(signal);
        await notifyClient(
          signal.requestId,
          renderDeletePublicationCompleteNotice({
            contentKind: deleteNoticeContentKind(capabilityRuntime.kind),
            locale,
            title: deletePublished.resolvedTitle,
          }),
        );
      } else {
        const result = await runtime.publish(signal);
        await notifyClient(
          signal.requestId,
          renderPublicationCompleteNotice({
            locale,
            urls: result.urls,
          }),
        );
      }
    } else {
      throw new Error('Reconciliation jobs are handled by maintenance.');
    }
    return await withSystemTenantScope(
      database,
      { operation: 'workflow.record_completion', tenantId: signal.tenantId },
      async (scoped) => {
        const outcome = await recordProcessedEvent(scoped, {
          consumer: `${capabilityRuntime.consumerPrefix}-executor-v1:${signal.reason}`,
          eventKey: signal.requestVersionId,
          result: { state: 'completed' },
          tenantId: signal.tenantId,
        });
        const calls = await scoped
          .select()
          .from(schema.modelCalls)
          .where(
            eq(schema.modelCalls.requestVersionId, signal.requestVersionId),
          );
        if (signal.reason === 'execute')
          await scoped
            .insert(schema.usageRecords)
            .values({
              capabilityId: context.capabilityId,
              estimatedCostCents: calls.reduce(
                (total, call) => total + call.estimatedCostCents,
                0,
              ),
              id: uuidv7(),
              modelCalls: calls.length,
              projectId: context.projectId,
              requestId: signal.requestId,
              requestVersionId: signal.requestVersionId,
              tenantId: signal.tenantId,
              tokens: calls.reduce(
                (total, call) => total + call.inputTokens + call.outputTokens,
                0,
              ),
            })
            .onConflictDoNothing();
        return { outcome };
      },
    );
  } finally {
    masterKey.fill(0);
  }
};

const QUEUED_STALE_MS = 2 * 60 * 1000;
const GENERATING_STALE_MS = 5 * 60 * 1000;
const REVALIDATING_STALE_MS = 12 * 60 * 1000;

const promoteFailedWorkflowJob = async (
  signal: ReturnType<typeof workflowResumeSignalSchema.parse>,
  error: Error,
): Promise<void> => {
  await withSystemTenantScope(
    database,
    { operation: 'workflow.promote_failed_job', tenantId: signal.tenantId },
    async (scoped) => {
      const [request] = await scoped
        .select()
        .from(schema.requests)
        .where(eq(schema.requests.id, signal.requestId))
        .limit(1);
      if (
        request === undefined ||
        !['QUEUED', 'GENERATING', 'FAILED_RETRYABLE'].includes(request.state)
      )
        return;
      const now = new Date();
      const nextVersion = request.version + 1;
      const terminal =
        request.terminalResult !== null &&
        typeof request.terminalResult === 'object'
          ? (request.terminalResult as Record<string, unknown>)
          : {};
      const retryable =
        error instanceof DomainError &&
        error.category === 'provider_retryable';
      const nextState = retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
      await scoped
        .update(schema.requests)
        .set({
          state: nextState,
          terminalResult: {
            ...terminal,
            errorCategory:
              error instanceof DomainError
                ? error.category
                : 'internal_error',
            errorMessage: error.message,
            failedNode:
              typeof terminal.failedNode === 'string'
                ? terminal.failedNode
                : 'failed',
          },
          updatedAt: now,
          version: nextVersion,
        })
        .where(eq(schema.requests.id, request.id));
      const [run] = await scoped
        .select()
        .from(schema.graphRuns)
        .where(eq(schema.graphRuns.requestVersionId, signal.requestVersionId))
        .limit(1);
      if (run !== undefined && run.status === 'running') {
        await scoped
          .update(schema.graphRuns)
          .set({ status: 'failed', updatedAt: now })
          .where(eq(schema.graphRuns.id, run.id));
      }
      if (nextState === 'FAILED_FINAL') {
        await scoped.insert(schema.outboxEvents).values({
          aggregateId: request.id,
          aggregateType: 'request',
          eventType: 'admin.notification_requested',
          eventVersion: nextVersion,
          id: uuidv7(),
          jobKey: `admin.notification:request.failed_final:${request.id}:${String(nextVersion)}`,
          payload: {
            message: `Request ${request.id} failed: ${error.message}. Open /requests/${request.id} in the dashboard.`,
            notificationType: 'request.failed_final',
            requestId: request.id,
          },
          projectId: request.projectId,
          tenantId: request.tenantId,
        });
      }
    },
  );
};

const recoverStaleWorkflowExecutions = async (): Promise<void> => {
  if (process.env.BINFLOW_LIVE_EXECUTION_ENABLED !== 'true') return;
  const now = Date.now();
  await withPlatformSystemScope(
    database,
    'workflow.recover_stale_executions',
    async (scoped) => {
      const queuedStale = await scoped
        .select({
          currentVersion: schema.requests.currentVersion,
          id: schema.requests.id,
          projectId: schema.requests.projectId,
          tenantId: schema.requests.tenantId,
          version: schema.requests.version,
        })
        .from(schema.requests)
        .where(
          and(
            eq(schema.requests.state, 'QUEUED'),
            lte(schema.requests.updatedAt, new Date(now - QUEUED_STALE_MS)),
          ),
        )
        .limit(10);
      for (const row of queuedStale) {
        const [version] = await scoped
          .select({ id: schema.requestVersions.id })
          .from(schema.requestVersions)
          .where(
            and(
              eq(schema.requestVersions.requestId, row.id),
              eq(schema.requestVersions.version, row.currentVersion),
            ),
          )
          .limit(1);
        if (version === undefined) continue;
        await scoped
          .insert(schema.outboxEvents)
          .values({
            aggregateId: row.id,
            aggregateType: 'request',
            eventType: 'workflow.resume_requested',
            eventVersion: row.version + 1,
            id: uuidv7(),
            jobKey: `workflow.resume:${version.id}:execute:recover-queued:${String(row.version)}`,
            payload: {
              reason: 'execute',
              requestId: row.id,
              requestVersionId: version.id,
              tenantId: row.tenantId,
            },
            projectId: row.projectId,
            tenantId: row.tenantId,
          })
          .onConflictDoNothing({ target: schema.outboxEvents.jobKey });
      }

      const generatingStale = await scoped
        .select({
          currentVersion: schema.requests.currentVersion,
          graphRunId: schema.graphRuns.id,
          id: schema.requests.id,
          projectId: schema.requests.projectId,
          tenantId: schema.requests.tenantId,
          version: schema.requests.version,
        })
        .from(schema.requests)
        .innerJoin(
          schema.graphRuns,
          eq(schema.graphRuns.requestId, schema.requests.id),
        )
        .where(
          and(
            eq(schema.requests.state, 'GENERATING'),
            lte(
              schema.requests.updatedAt,
              new Date(now - GENERATING_STALE_MS),
            ),
            inArray(schema.graphRuns.status, ['running', 'queued']),
          ),
        )
        .limit(10);
      for (const row of generatingStale) {
        const [version] = await scoped
          .select({ id: schema.requestVersions.id })
          .from(schema.requestVersions)
          .where(
            and(
              eq(schema.requestVersions.requestId, row.id),
              eq(schema.requestVersions.version, row.currentVersion),
            ),
          )
          .limit(1);
        if (version === undefined) continue;
        const nextVersion = row.version + 1;
        await scoped
          .update(schema.requests)
          .set({
            state: 'FAILED_RETRYABLE',
            terminalResult: {
              errorCategory: 'provider_retryable',
              errorMessage:
                'Workflow interrupted before completion; scheduled recovery retry.',
              failedNode: 'recover_stale_execution',
            },
            updatedAt: new Date(),
            version: nextVersion,
          })
          .where(
            and(
              eq(schema.requests.id, row.id),
              eq(schema.requests.state, 'GENERATING'),
            ),
          );
        await scoped
          .update(schema.graphRuns)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(schema.graphRuns.id, row.graphRunId));
        await scoped
          .insert(schema.outboxEvents)
          .values({
            aggregateId: row.id,
            aggregateType: 'request',
            eventType: 'workflow.resume_requested',
            eventVersion: nextVersion + 1,
            id: uuidv7(),
            jobKey: `workflow.resume:${version.id}:execute:recover-generating:${String(nextVersion)}`,
            payload: {
              reason: 'execute',
              requestId: row.id,
              requestVersionId: version.id,
              tenantId: row.tenantId,
            },
            projectId: row.projectId,
            tenantId: row.tenantId,
          })
          .onConflictDoNothing({ target: schema.outboxEvents.jobKey });
      }

      const revalidatingStale = await scoped
        .select({
          currentVersion: schema.requests.currentVersion,
          id: schema.requests.id,
          projectId: schema.requests.projectId,
          requestVersionId: schema.publicationAttempts.requestVersionId,
          tenantId: schema.requests.tenantId,
          version: schema.requests.version,
        })
        .from(schema.requests)
        .innerJoin(
          schema.publicationAttempts,
          and(
            eq(schema.publicationAttempts.requestId, schema.requests.id),
            eq(schema.publicationAttempts.status, 'running'),
          ),
        )
        .where(
          and(
            eq(schema.requests.state, 'REVALIDATING'),
            lte(
              schema.requests.updatedAt,
              new Date(now - REVALIDATING_STALE_MS),
            ),
          ),
        )
        .limit(10);
      for (const row of revalidatingStale) {
        const [version] = await scoped
          .select({ id: schema.requestVersions.id })
          .from(schema.requestVersions)
          .where(
            and(
              eq(schema.requestVersions.requestId, row.id),
              eq(schema.requestVersions.version, row.currentVersion),
            ),
          )
          .limit(1);
        if (version === undefined) continue;
        const nextVersion = row.version + 1;
        await scoped
          .update(schema.requests)
          .set({
            state: 'APPROVED_FOR_PUBLISH',
            updatedAt: new Date(),
            version: nextVersion,
          })
          .where(
            and(
              eq(schema.requests.id, row.id),
              eq(schema.requests.state, 'REVALIDATING'),
            ),
          );
        await scoped
          .update(schema.publicationAttempts)
          .set({ status: 'failed_retryable' })
          .where(
            and(
              eq(schema.publicationAttempts.requestId, row.id),
              eq(schema.publicationAttempts.status, 'running'),
            ),
          );
        await scoped
          .insert(schema.outboxEvents)
          .values({
            aggregateId: row.id,
            aggregateType: 'request',
            eventType: 'workflow.resume_requested',
            eventVersion: nextVersion + 1,
            id: uuidv7(),
            jobKey: `workflow.resume:${version.id}:publish:recover-revalidating:${String(nextVersion)}`,
            payload: {
              reason: 'publish',
              requestId: row.id,
              requestVersionId: version.id,
              tenantId: row.tenantId,
            },
            projectId: row.projectId,
            tenantId: row.tenantId,
          })
          .onConflictDoNothing({ target: schema.outboxEvents.jobKey });
      }
    },
  );
};

const recoverUnmergedPublications = async (): Promise<void> => {
  await withPlatformSystemScope(
    database,
    'workflow.recover_unmerged_publications',
    async (scoped) => {
      const failed = await scoped
        .select({
          attemptId: schema.publicationAttempts.id,
          projectId: schema.requests.projectId,
          requestId: schema.requests.id,
          requestVersionId: schema.publicationAttempts.requestVersionId,
          tenantId: schema.requests.tenantId,
          version: schema.requests.version,
        })
        .from(schema.publicationAttempts)
        .innerJoin(
          schema.requests,
          eq(schema.requests.id, schema.publicationAttempts.requestId),
        )
        .leftJoin(
          schema.deployments,
          and(
            eq(
              schema.deployments.requestVersionId,
              schema.publicationAttempts.requestVersionId,
            ),
            eq(schema.deployments.environment, 'production'),
          ),
        )
        .where(
          and(
            eq(schema.requests.state, 'FAILED_FINAL'),
            eq(schema.publicationAttempts.status, 'failed_final'),
            isNull(schema.deployments.id),
          ),
        );
      for (const row of failed) {
        await scoped
          .insert(schema.outboxEvents)
          .values({
            aggregateId: row.requestId,
            aggregateType: 'request',
            eventType: 'workflow.resume_requested',
            eventVersion: row.version + 1,
            id: uuidv7(),
            jobKey: `workflow.resume:${row.requestVersionId}:publish:recover`,
            payload: {
              reason: 'publish',
              requestId: row.requestId,
              requestVersionId: row.requestVersionId,
              tenantId: row.tenantId,
            },
            projectId: row.projectId,
            tenantId: row.tenantId,
          })
          .onConflictDoNothing({ target: schema.outboxEvents.jobKey });
      }
    },
  );
};

const OUTBOX_DELIVERY_LEASE_MS = 120_000;

/**
 * Atomically lease a pending outbox row before side effects. Concurrent workers
 * that lose the race see no row and must not deliver the same notice twice.
 */
const claimPendingOutboxEvent = async (
  scoped: Parameters<Parameters<typeof withPlatformSystemScope>[2]>[0],
  eventId: string,
): Promise<(typeof schema.outboxEvents.$inferSelect) | undefined> => {
  const now = new Date();
  const [claimed] = await scoped
    .update(schema.outboxEvents)
    .set({
      availableAt: new Date(now.getTime() + OUTBOX_DELIVERY_LEASE_MS),
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.outboxEvents.id, eventId),
        eq(schema.outboxEvents.status, 'pending'),
        lte(schema.outboxEvents.availableAt, now),
      ),
    )
    .returning();
  return claimed;
};

const markOutboxPublished = async (
  scoped: Parameters<Parameters<typeof withPlatformSystemScope>[2]>[0],
  event: typeof schema.outboxEvents.$inferSelect,
): Promise<void> => {
  await scoped
    .update(schema.outboxEvents)
    .set({
      attempts: event.attempts + 1,
      publishedAt: new Date(),
      status: 'published',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.outboxEvents.id, event.id),
        eq(schema.outboxEvents.status, 'pending'),
      ),
    );
};

const markOutboxDeliveryFailed = async (
  scoped: Parameters<Parameters<typeof withPlatformSystemScope>[2]>[0],
  event: typeof schema.outboxEvents.$inferSelect,
): Promise<void> => {
  const attempts = event.attempts + 1;
  await scoped
    .update(schema.outboxEvents)
    .set({
      attempts,
      availableAt: new Date(
        Date.now() + Math.min(300_000, 2 ** attempts * 1_000),
      ),
      status: attempts >= 10 ? 'failed' : 'pending',
      updatedAt: new Date(),
    })
    .where(eq(schema.outboxEvents.id, event.id));
};

const dispatchOutbox = async (): Promise<void> => {
  if (process.env.BINFLOW_LIVE_EXECUTION_ENABLED !== 'true') return;
  await recoverUnmergedPublications();
  await recoverStaleWorkflowExecutions();
  await withPlatformSystemScope(
    database,
    'workflow.outbox_dispatch',
    async (scoped) => {
      const events = await scoped
        .select()
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.status, 'pending'),
            eq(schema.outboxEvents.eventType, 'workflow.resume_requested'),
            lte(schema.outboxEvents.availableAt, new Date()),
          ),
        )
        .orderBy(asc(schema.outboxEvents.createdAt))
        .limit(20);
      for (const event of events) {
        const claimed = await claimPendingOutboxEvent(scoped, event.id);
        if (claimed === undefined) continue;
        await queue.add('workflow.resume', claimed.payload, {
          attempts: 4,
          backoff: { delay: 2_000, type: 'exponential' },
          jobId: claimed.jobKey.replaceAll(':', '-'),
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
        await markOutboxPublished(scoped, claimed);
        await scoped.insert(schema.auditEvents).values({
          action: 'workflow.resume_dispatched',
          actorId: 'worker:outbox',
          actorType: 'system',
          correlationId: claimed.jobKey,
          id: uuidv7(),
          metadata: { outboxEventId: claimed.id },
          objectId: claimed.aggregateId,
          objectType: claimed.aggregateType,
          ...(claimed.projectId === null
            ? {}
            : { projectId: claimed.projectId }),
          ...(claimed.tenantId === null ? {} : { tenantId: claimed.tenantId }),
        });
      }
    },
  );
};

const dispatchAdminNotifications = async (): Promise<void> => {
  await withPlatformSystemScope(
    database,
    'admin.notification_dispatch',
    async (scoped) => {
      const [target] = await scoped
        .select({
          botId: schema.adminNotificationTargets.botId,
          chatId: schema.adminNotificationTargets.chatId,
        })
        .from(schema.adminNotificationTargets)
        .where(eq(schema.adminNotificationTargets.status, 'active'))
        .limit(1);
      if (target === undefined) return;
      const runtime = adminTelegramRuntimes.get(target.botId);
      if (runtime === undefined) return;
      const events = await scoped
        .select()
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.status, 'pending'),
            eq(schema.outboxEvents.eventType, 'admin.notification_requested'),
            lte(schema.outboxEvents.availableAt, new Date()),
          ),
        )
        .orderBy(asc(schema.outboxEvents.createdAt))
        .limit(20);
      for (const event of events) {
        const message = (event.payload as { message?: unknown }).message;
        if (typeof message !== 'string') continue;
        const claimed = await claimPendingOutboxEvent(scoped, event.id);
        if (claimed === undefined) continue;
        try {
          await runtime.adapter.postMessage(
            `telegram:${target.chatId}`,
            message,
          );
          await markOutboxPublished(scoped, claimed);
          await scoped.insert(schema.auditEvents).values({
            action: 'admin.notification_delivered',
            actorId: 'worker:notifications',
            actorType: 'system',
            correlationId: claimed.jobKey,
            id: uuidv7(),
            metadata: { outboxEventId: claimed.id },
            objectId: claimed.aggregateId,
            objectType: claimed.aggregateType,
            ...(claimed.projectId === null
              ? {}
              : { projectId: claimed.projectId }),
            ...(claimed.tenantId === null
              ? {}
              : { tenantId: claimed.tenantId }),
          });
        } catch {
          await markOutboxDeliveryFailed(scoped, claimed);
        }
      }
    },
  );
};

const dispatchClientNotifications = async (): Promise<void> => {
  await withPlatformSystemScope(
    database,
    'client.notification_dispatch',
    async (scoped) => {
      const events = await scoped
        .select()
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.status, 'pending'),
            eq(schema.outboxEvents.eventType, 'client.notification_requested'),
            lte(schema.outboxEvents.availableAt, new Date()),
          ),
        )
        .orderBy(asc(schema.outboxEvents.createdAt))
        .limit(20);
      for (const event of events) {
        const message = (event.payload as { message?: unknown }).message;
        if (typeof message !== 'string') continue;
        const claimed = await claimPendingOutboxEvent(scoped, event.id);
        if (claimed === undefined) continue;
        // The destination is always derived from the paired identity, never
        // from the stored payload.
        const [target] = await scoped
          .select({
            botId: schema.channelIdentities.botId,
            chatId: schema.channelIdentities.chatId,
          })
          .from(schema.requests)
          .innerJoin(
            schema.channelIdentities,
            eq(schema.channelIdentities.userId, schema.requests.userId),
          )
          .where(eq(schema.requests.id, claimed.aggregateId))
          .limit(1);
        const runtime =
          target === undefined
            ? undefined
            : clientTelegramRuntimes.get(target.botId);
        let delivered = false;
        if (target !== undefined && runtime !== undefined) {
          try {
            await runtime.adapter.postMessage(
              `telegram:${target.chatId}`,
              message,
            );
            delivered = true;
          } catch (error) {
            logger.error(
              { error, outboxEventId: claimed.id },
              'Client notification delivery failed',
            );
          }
        }
        if (!delivered) {
          await markOutboxDeliveryFailed(scoped, claimed);
          continue;
        }
        await markOutboxPublished(scoped, claimed);
        await scoped.insert(schema.auditEvents).values({
          action: 'client.notification_delivered',
          actorId: 'worker:notifications',
          actorType: 'system',
          correlationId: claimed.jobKey,
          id: uuidv7(),
          metadata: { outboxEventId: claimed.id },
          objectId: claimed.aggregateId,
          objectType: claimed.aggregateType,
          ...(claimed.projectId === null
            ? {}
            : { projectId: claimed.projectId }),
          ...(claimed.tenantId === null ? {} : { tenantId: claimed.tenantId }),
        });
      }
    },
  );
};

const heartbeat = async (): Promise<void> => {
  await telegramPollingLock.renewHeld();
  await withPlatformSystemScope(
    database,
    'worker.heartbeat',
    async (scoped) => {
      await scoped
        .insert(schema.serviceHeartbeats)
        .values({
          instanceId: process.env.HOSTNAME ?? 'local-worker',
          lastSeenAt: new Date(),
          metadata: {
            liveExecution:
              process.env.BINFLOW_LIVE_EXECUTION_ENABLED === 'true',
          },
          service: 'worker',
        })
        .onConflictDoUpdate({
          set: {
            instanceId: process.env.HOSTNAME ?? 'local-worker',
            lastSeenAt: new Date(),
            metadata: {
              liveExecution:
                process.env.BINFLOW_LIVE_EXECUTION_ENABLED === 'true',
            },
          },
          target: schema.serviceHeartbeats.service,
        });
    },
  );
};

const telegramRuntimes: TelegramRuntime[] = [];
const startTelegram = async (): Promise<void> => {
  const masterKey = await loadRuntimeMasterKeyFile(
    process.env.BINFLOW_KEK_FILE ?? defaultMasterKeyPath(),
  );
  try {
    const credentials = await withPlatformSystemScope(
      database,
      'telegram.runtime_start',
      async (scoped) => {
        const rows = await scoped
          .select({ id: schema.providerCredentials.id })
          .from(schema.providerCredentials)
          .where(
            and(
              inArray(schema.providerCredentials.kind, [
                'telegram-admin',
                'telegram-client',
              ]),
              eq(schema.providerCredentials.status, 'active'),
            ),
          );
        return Promise.all(
          rows.map((row) => getCredentialForVerification(scoped, row.id)),
        );
      },
    );
    for (const credential of credentials) {
      if (
        credential === undefined ||
        (credential.kind !== 'telegram-admin' &&
          credential.kind !== 'telegram-client')
      )
        continue;
      const plaintext = decryptSecret(
        credential.envelope,
        masterKey,
        credential.secretContext,
      );
      try {
        const payload = JSON.parse(plaintext.toString('utf8')) as {
          botToken?: unknown;
        };
        const username = credential.configuration.expectedUsername;
        if (
          typeof payload.botToken !== 'string' ||
          typeof username !== 'string'
        )
          throw new Error('Telegram runtime credential is malformed.');
        const botId = await withPlatformSystemScope(
          database,
          'telegram.resolve_bot_identity',
          async (scoped) => {
            const [row] = await scoped
              .select({
                botId: schema.providerCredentials.externalResourceId,
              })
              .from(schema.providerCredentials)
              .where(eq(schema.providerCredentials.id, credential.id))
              .limit(1);
            return row?.botId;
          },
        );
        if (botId === null || botId === undefined)
          throw new Error('Telegram verified bot ID is missing.');
        const pollingEnabled = await telegramPollingLock.tryAcquire(botId);
        const runtime = await createTelegramRuntime({
          botToken: payload.botToken,
          ingress: pollingEnabled ? 'polling' : 'send-only',
          redisUrl,
          role: credential.kind === 'telegram-admin' ? 'admin' : 'client',
          scopeKey: credential.tenantId ?? 'platform',
          userName: username,
        });
        if (credential.kind === 'telegram-client') {
          if (pollingEnabled) {
            registerClientTelegramHandlers(runtime, {
              botId,
              handler: workflowService,
              persistInboundImage: async ({ bytes, mime }) => {
                const extension =
                  mime === 'image/png'
                    ? 'png'
                    : mime === 'image/webp'
                      ? 'webp'
                      : 'jpg';
                const key = `inbound/telegram/${uuidv7()}.${extension}`;
                const sha256 = createHash('sha256')
                  .update(Buffer.from(bytes))
                  .digest('hex');
                await artifactStore.put({ bytes, key, mime, sha256 });
                return key;
              },
            });
          }
          clientTelegramRuntimes.set(botId, runtime);
        } else {
          if (pollingEnabled) {
            registerAdminTelegramHandlers(runtime, {
              botId,
              handler: (update) =>
                workflowService.handleAdminTelegramUpdate(update),
            });
          }
          adminTelegramRuntimes.set(botId, runtime);
        }
        await runtime.chat.initialize();
        telegramRuntimes.push(runtime);
        logger.info(
          {
            botId,
            ingress: pollingEnabled ? 'polling' : 'send-only',
            role: credential.kind,
          },
          pollingEnabled
            ? 'Telegram polling runtime started'
            : 'Telegram runtime started in send-only mode because another worker holds the polling lock',
        );
      } finally {
        plaintext.fill(0);
      }
    }
  } finally {
    masterKey.fill(0);
  }
};

await startTelegram();
const worker = new Worker(
  'binflow-workflows',
  async (job) => {
    try {
      return await processWorkflowJob(job.name, job.data);
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.category !== 'provider_retryable' &&
        error.category !== 'internal_error'
      )
        throw new UnrecoverableError(error.message);
      throw error;
    }
  },
  { connection, lockDuration: 120_000, maxStalledCount: 2, stalledInterval: 30_000 },
);
worker.on('ready', () => {
  const liveEnabled = process.env.BINFLOW_LIVE_EXECUTION_ENABLED === 'true';
  logger.info(
    { liveExecutionEnabled: liveEnabled },
    liveEnabled
      ? 'Worker is ready (live workflow execution enabled)'
      : 'Worker is ready (live workflow execution DISABLED; QUEUED requests stay pending until BINFLOW_LIVE_EXECUTION_ENABLED=true)',
  );
});
worker.on('error', (error) => logger.error({ error }, 'Worker error'));
worker.on('failed', (job, error) => {
  logger.error(
    { error, jobId: job?.id, requestId: job?.data },
    'Workflow job failed',
  );
  if (job === undefined) return;
  const signal = workflowResumeSignalSchema.safeParse(job.data);
  if (!signal.success) return;
  const maxAttempts = job.opts.attempts ?? 1;
  const isUnrecoverable = error instanceof UnrecoverableError;
  const exhausted = job.attemptsMade >= maxAttempts;
  if (!isUnrecoverable && !exhausted) return;
  void promoteFailedWorkflowJob(signal.data, error).catch(
    (promoteError: unknown) =>
      logger.error(
        { promoteError, requestId: signal.data.requestId },
        'Failed to promote failed workflow job',
      ),
  );
});
const outboxTimer = setInterval(() => {
  void (async () => {
    await dispatchOutbox();
    await dispatchAdminNotifications();
    await dispatchClientNotifications();
  })().catch((error: unknown) => logger.error({ error }, 'Worker loop failed'));
}, 2_000);
const heartbeatTimer = setInterval(() => void heartbeat(), 10_000);
await dispatchOutbox();
await dispatchAdminNotifications();
await dispatchClientNotifications();
await heartbeat();

const close = async (): Promise<void> => {
  clearInterval(outboxTimer);
  clearInterval(heartbeatTimer);
  await Promise.all(telegramRuntimes.map((runtime) => runtime.chat.shutdown()));
  await telegramPollingLock.releaseAll();
  await worker.close();
  await queue.close();
  await connection.quit();
  await pool.end();
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
