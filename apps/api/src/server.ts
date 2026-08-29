import { readFile } from 'node:fs/promises';

import { buildApp } from './app.js';
import { createApiAuthRuntime } from './auth.js';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { EnrollmentService } from '@binflow/onboarding';
import { IntegrationAdminService } from '@binflow/integration-admin';
import { WorkflowService } from '@binflow/workflows';
import { ToolCatalogService } from '@binflow/tools';
import { schema, withPlatformSystemScope } from '@binflow/db';
import {
  defaultMasterKeyPath,
  loadRuntimeMasterKeyFile,
} from '@binflow/secrets';

const authRuntime = await createApiAuthRuntime();
const redisUrl =
  process.env.REDIS_URL ??
  (process.env.REDIS_URL_FILE === undefined
    ? 'redis://localhost:6379'
    : (await readFile(process.env.REDIS_URL_FILE, 'utf8')).trim());
const redis = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const readinessCheck = async () => {
  const checks: Record<
    string,
    'ready' | 'unavailable' | 'stale' | 'misconfigured'
  > = {};
  try {
    const state = await withPlatformSystemScope(
      authRuntime.database,
      'api.readiness',
      async (database) => ({
        credentials: await database
          .select({ kind: schema.providerCredentials.kind })
          .from(schema.providerCredentials)
          .where(eq(schema.providerCredentials.status, 'active')),
        heartbeat: (
          await database
            .select()
            .from(schema.serviceHeartbeats)
            .where(eq(schema.serviceHeartbeats.service, 'worker'))
            .limit(1)
        )[0],
      }),
    );
    checks.database = 'ready';
    const required = new Set([
      'openai',
      'telegram-admin',
      'telegram-client',
      'github-app',
      'vercel',
    ]);
    for (const credential of state.credentials)
      required.delete(credential.kind);
    checks.credentials = required.size === 0 ? 'ready' : 'misconfigured';
    checks.worker =
      state.heartbeat !== undefined &&
      Date.now() - state.heartbeat.lastSeenAt.getTime() <= 30_000
        ? 'ready'
        : 'stale';
  } catch {
    checks.database = 'unavailable';
    checks.credentials = 'unavailable';
    checks.worker = 'unavailable';
  }
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.ping();
    checks.redis = 'ready';
  } catch {
    checks.redis = 'unavailable';
  }
  try {
    const response = await fetch(
      `${process.env.S3_ENDPOINT ?? 'http://localhost:9000'}/minio/health/live`,
      { signal: AbortSignal.timeout(3_000) },
    );
    checks.objectStorage = response.ok ? 'ready' : 'unavailable';
  } catch {
    checks.objectStorage = 'unavailable';
  }
  return {
    checks,
    status: Object.values(checks).every((value) => value === 'ready')
      ? ('ready' as const)
      : ('not_ready' as const),
    timestamp: new Date().toISOString(),
  };
};
const app = buildApp({
  auth: authRuntime.auth,
  enrollmentService: new EnrollmentService(authRuntime.database),
  integrationService: new IntegrationAdminService(authRuntime.database, () =>
    loadRuntimeMasterKeyFile(
      process.env.BINFLOW_KEK_FILE ?? defaultMasterKeyPath(),
    ),
  ),
  readinessCheck,
  toolCatalogService: new ToolCatalogService(authRuntime.database),
  workflowService: new WorkflowService(authRuntime.database),
});

const close = async (): Promise<void> => {
  await app.close();
  if (redis.status === 'wait') redis.disconnect();
  else if (redis.status !== 'end') await redis.quit();
  await authRuntime.close();
  process.exitCode = 0;
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

await app.listen({
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8080),
});
