import { readFile } from 'node:fs/promises';

import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import pino from 'pino';

import { createDatabase, schema, withPlatformSystemScope } from '@binflow/db';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const readConfiguredValue = async (
  directName: string,
  fileName: string,
  fallback: string,
): Promise<string> => {
  const direct = process.env[directName];
  if (direct !== undefined) return direct;
  const path = process.env[fileName];
  return path === undefined ? fallback : (await readFile(path, 'utf8')).trim();
};

const databaseUrl = await readConfiguredValue(
  'DATABASE_URL',
  'DATABASE_URL_FILE',
  'postgresql://binflow:binflow_local@localhost:5432/binflow',
);
const { db, pool } = createDatabase(databaseUrl);
try {
  const now = new Date();
  const stalePublication = new Date(now.getTime() - 30 * 60 * 1_000);
  const result = await withPlatformSystemScope(
    db,
    'maintenance.reconcile',
    async (database) => {
      const actions = await database
        .update(schema.requestActions)
        .set({ revokedAt: now })
        .where(
          and(
            isNull(schema.requestActions.consumedAt),
            isNull(schema.requestActions.revokedAt),
            lt(schema.requestActions.expiresAt, now),
          ),
        )
        .returning({ id: schema.requestActions.id });
      const adminPairing = await database
        .update(schema.adminPairingTokens)
        .set({ revokedAt: now })
        .where(
          and(
            isNull(schema.adminPairingTokens.consumedAt),
            isNull(schema.adminPairingTokens.revokedAt),
            lt(schema.adminPairingTokens.expiresAt, now),
          ),
        )
        .returning({ id: schema.adminPairingTokens.id });
      const clientPairing = await database
        .update(schema.pairingTokens)
        .set({ revokedAt: now })
        .where(
          and(
            isNull(schema.pairingTokens.consumedAt),
            isNull(schema.pairingTokens.revokedAt),
            lt(schema.pairingTokens.expiresAt, now),
          ),
        )
        .returning({ id: schema.pairingTokens.id });
      const publications = await database
        .update(schema.publicationAttempts)
        .set({
          completedAt: now,
          result: { reconciliationRequired: true },
          status: 'failed_retryable',
        })
        .where(
          and(
            eq(schema.publicationAttempts.status, 'running'),
            lt(schema.publicationAttempts.createdAt, stalePublication),
          ),
        )
        .returning({ id: schema.publicationAttempts.id });
      const deadLetters = await database
        .update(schema.outboxEvents)
        .set({ status: 'failed', updatedAt: now })
        .where(
          and(
            eq(schema.outboxEvents.status, 'pending'),
            sql`${schema.outboxEvents.attempts} >= 10`,
          ),
        )
        .returning({ id: schema.outboxEvents.id });
      await database
        .insert(schema.serviceHeartbeats)
        .values({
          instanceId: process.env.HOSTNAME ?? 'local-maintenance',
          lastSeenAt: now,
          metadata: { completed: true },
          service: 'maintenance',
        })
        .onConflictDoUpdate({
          set: {
            instanceId: process.env.HOSTNAME ?? 'local-maintenance',
            lastSeenAt: now,
            metadata: { completed: true },
          },
          target: schema.serviceHeartbeats.service,
        });
      return {
        expiredActions: actions.length,
        expiredAdminPairing: adminPairing.length,
        expiredClientPairing: clientPairing.length,
        markedDeadLetter: deadLetters.length,
        stalePublications: publications.length,
      };
    },
  );
  logger.info(
    { result, version: process.env.BINFLOW_VERSION ?? 'development' },
    'Maintenance reconciliation completed',
  );
} finally {
  await pool.end();
}
