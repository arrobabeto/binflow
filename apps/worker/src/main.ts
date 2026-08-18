import { readFile } from 'node:fs/promises';

import { Queue, Worker } from 'bullmq';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { Redis } from 'ioredis';
import pino from 'pino';
import { v7 as uuidv7 } from 'uuid';

import { workflowResumeSignalSchema } from '@binflow/contracts';
import {
  createDatabase,
  getCredentialForVerification,
  recordProcessedEvent,
  schema,
  withPlatformSystemScope,
  withSystemTenantScope,
} from '@binflow/db';
import {
  createTelegramRuntime,
  registerClientTelegramHandlers,
  type TelegramRuntime,
} from '@binflow/messaging';
import {
  decryptSecret,
  defaultMasterKeyPath,
  loadRuntimeMasterKeyFile,
} from '@binflow/secrets';
import { WorkflowService } from '@binflow/workflows';

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

const worker = new Worker(
  'binflow-workflows',
  async (job) => {
    if (job.name !== 'workflow.resume')
      throw new Error(`Unsupported workflow job: ${job.name}`);
    const signal = workflowResumeSignalSchema.parse(job.data);
    return withSystemTenantScope(
      database,
      { operation: 'workflow.resume', tenantId: signal.tenantId },
      async (scoped) => {
        const outcome = await recordProcessedEvent(scoped, {
          consumer: 'workflow-kernel-v1',
          eventKey: signal.requestVersionId,
          result: { state: 'executor_pending' },
          tenantId: signal.tenantId,
        });
        if (outcome === 'duplicate') return { outcome };
        const [run] = await scoped
          .select()
          .from(schema.graphRuns)
          .where(eq(schema.graphRuns.requestVersionId, signal.requestVersionId))
          .limit(1);
        if (run === undefined) throw new Error('Durable graph run is missing.');
        await scoped
          .update(schema.graphRuns)
          .set({
            checkpointSequence: 2,
            currentNode: 'content_executor_pending',
            status: 'interrupted',
            updatedAt: new Date(),
          })
          .where(eq(schema.graphRuns.id, run.id));
        await scoped.insert(schema.workflowCheckpoints).values({
          graphRunId: run.id,
          id: uuidv7(),
          node: 'content_executor_pending',
          projectId: run.projectId,
          sequence: 2,
          state: { requestState: 'QUEUED' },
          tenantId: run.tenantId,
        });
        logger.info(
          {
            requestId: signal.requestId,
            requestVersionId: signal.requestVersionId,
          },
          'Workflow safely paused at the Module 8 executor boundary',
        );
        return { outcome: 'interrupted' };
      },
    );
  },
  { connection },
);

const dispatchOutbox = async (): Promise<void> => {
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
        } else {
          runtime.chat.onDirectMessage(async (thread) => {
            await thread.post(
              'Binflow admin bot is active. Operational notifications will appear here.',
            );
          });
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

worker.on('ready', () => logger.info('Worker is ready'));
worker.on('error', (error) => logger.error({ error }, 'Worker error'));
const outboxTimer = setInterval(() => {
  void dispatchOutbox().catch((error: unknown) =>
    logger.error({ error }, 'Outbox dispatch failed'),
  );
}, 2_000);
await startTelegram();
await dispatchOutbox();

const close = async (): Promise<void> => {
  clearInterval(outboxTimer);
  await Promise.all(telegramRuntimes.map((runtime) => runtime.chat.shutdown()));
  await worker.close();
  await queue.close();
  await connection.quit();
  await pool.end();
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
