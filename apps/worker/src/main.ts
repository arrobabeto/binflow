import { readFile } from 'node:fs/promises';

import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { Redis } from 'ioredis';
import pino from 'pino';
import { v7 as uuidv7 } from 'uuid';

import { workflowResumeSignalSchema } from '@binflow/contracts';
import { createOpenAIBlogGenerationPort } from '@binflow/ai';
import { S3ArtifactStore } from '@binflow/artifacts';
import { BlogExecutor } from '@binflow/blog';
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
import { DomainError } from '@binflow/domain';
import {
  createTelegramRuntime,
  registerAdminTelegramHandlers,
  registerClientTelegramHandlers,
  type TelegramRuntime,
} from '@binflow/messaging';
import {
  decryptSecret,
  defaultMasterKeyPath,
  loadRuntimeMasterKeyFile,
} from '@binflow/secrets';
import { createVercelDeploymentPort } from '@binflow/vercel';
import { BlogWorkflowRuntime, WorkflowService } from '@binflow/workflows';

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
const workflowService = new WorkflowService(database);
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
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
        .select({ projectId: schema.requests.projectId })
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

const notifyClient = async (requestId: string, text: string): Promise<void> => {
  const target = await withPlatformSystemScope(
    database,
    'workflow.resolve_client_notification',
    async (scoped) => {
      const [row] = await scoped
        .select({
          botId: schema.channelIdentities.botId,
          chatId: schema.channelIdentities.chatId,
        })
        .from(schema.requests)
        .innerJoin(
          schema.channelIdentities,
          eq(schema.channelIdentities.userId, schema.requests.userId),
        )
        .where(eq(schema.requests.id, requestId))
        .limit(1);
      return row;
    },
  );
  if (target === undefined) return;
  const runtime = clientTelegramRuntimes.get(target.botId);
  if (runtime === undefined) return;
  await runtime.adapter.postMessage(`telegram:${target.chatId}`, text);
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
    const generation = createOpenAIBlogGenerationPort({
      credential: context.openai,
      masterKey,
      onModelCall: async (evidence) => {
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
                  ? 'image'
                  : evidence.model === 'text-embedding-3-small'
                    ? 'similarity'
                    : 'editorial',
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
      },
    });
    const catalog = createGitHubContentCatalogPort({
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
    const runtime = new BlogWorkflowRuntime(
      database,
      artifactStore,
      new BlogExecutor(catalog, generation, repository, deployments),
    );
    if (signal.reason === 'execute') {
      const result = await runtime.execute(signal);
      const actionText = [
        `Preview listo para ${result.result.bundle.es.titulo}.`,
        ...Object.entries(result.result.deployment.urls).map(
          ([route, url]) => `${route}: ${url}`,
        ),
        `Aprobar: /action ${result.actions.approve}`,
        `Pedir revisión: /action ${result.actions.revise}`,
        `Cancelar: /action ${result.actions.cancel}`,
      ].join('\n');
      await notifyClient(signal.requestId, actionText);
    } else if (signal.reason === 'publish') {
      const result = await runtime.publish(signal);
      await notifyClient(
        signal.requestId,
        [
          'Publicación completada.',
          ...Object.entries(result.urls).map(
            ([route, url]) => `${route}: ${url}`,
          ),
        ].join('\n'),
      );
    } else {
      throw new Error('Reconciliation jobs are handled by maintenance.');
    }
    return await withSystemTenantScope(
      database,
      { operation: 'workflow.record_completion', tenantId: signal.tenantId },
      async (scoped) => {
        const outcome = await recordProcessedEvent(scoped, {
          consumer: `blog-executor-v1:${signal.reason}`,
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
              capabilityId: 'create_blog_draft',
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

const dispatchOutbox = async (): Promise<void> => {
  if (process.env.BINFLOW_LIVE_EXECUTION_ENABLED !== 'true') return;
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
        await queue.add('workflow.resume', event.payload, {
          attempts: 4,
          backoff: { delay: 2_000, type: 'exponential' },
          jobId: event.jobKey.replaceAll(':', '-'),
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
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
        await scoped.insert(schema.auditEvents).values({
          action: 'workflow.resume_dispatched',
          actorId: 'worker:outbox',
          actorType: 'system',
          correlationId: event.jobKey,
          id: uuidv7(),
          metadata: { outboxEventId: event.id },
          objectId: event.aggregateId,
          objectType: event.aggregateType,
          ...(event.projectId === null ? {} : { projectId: event.projectId }),
          ...(event.tenantId === null ? {} : { tenantId: event.tenantId }),
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
        try {
          await runtime.adapter.postMessage(
            `telegram:${target.chatId}`,
            message,
          );
          await scoped
            .update(schema.outboxEvents)
            .set({
              attempts: event.attempts + 1,
              publishedAt: new Date(),
              status: 'published',
              updatedAt: new Date(),
            })
            .where(eq(schema.outboxEvents.id, event.id));
          await scoped.insert(schema.auditEvents).values({
            action: 'admin.notification_delivered',
            actorId: 'worker:notifications',
            actorType: 'system',
            correlationId: event.jobKey,
            id: uuidv7(),
            metadata: { outboxEventId: event.id },
            objectId: event.aggregateId,
            objectType: event.aggregateType,
            ...(event.projectId === null ? {} : { projectId: event.projectId }),
            ...(event.tenantId === null ? {} : { tenantId: event.tenantId }),
          });
        } catch {
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
        }
      }
    },
  );
};

const heartbeat = async (): Promise<void> => {
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
        const runtime = await createTelegramRuntime({
          botToken: payload.botToken,
          redisUrl,
          role: credential.kind === 'telegram-admin' ? 'admin' : 'client',
          scopeKey: credential.tenantId ?? 'platform',
          userName: username,
        });
        if (credential.kind === 'telegram-client') {
          registerClientTelegramHandlers(runtime, {
            botId,
            handler: workflowService,
          });
          clientTelegramRuntimes.set(botId, runtime);
        } else {
          registerAdminTelegramHandlers(runtime, {
            botId,
            handler: (update) =>
              workflowService.handleAdminTelegramUpdate(update),
          });
          adminTelegramRuntimes.set(botId, runtime);
        }
        await runtime.chat.initialize();
        telegramRuntimes.push(runtime);
        logger.info(
          { botId, role: credential.kind },
          'Telegram polling runtime started',
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
  { connection },
);
worker.on('ready', () => logger.info('Worker is ready'));
worker.on('error', (error) => logger.error({ error }, 'Worker error'));
const outboxTimer = setInterval(() => {
  void (async () => {
    await dispatchOutbox();
    await dispatchAdminNotifications();
  })().catch((error: unknown) => logger.error({ error }, 'Worker loop failed'));
}, 2_000);
const heartbeatTimer = setInterval(() => void heartbeat(), 10_000);
await dispatchOutbox();
await dispatchAdminNotifications();
await heartbeat();

const close = async (): Promise<void> => {
  clearInterval(outboxTimer);
  clearInterval(heartbeatTimer);
  await Promise.all(telegramRuntimes.map((runtime) => runtime.chat.shutdown()));
  await worker.close();
  await queue.close();
  await connection.quit();
  await pool.end();
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
