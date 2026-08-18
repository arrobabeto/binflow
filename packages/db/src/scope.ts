import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { DomainError } from '@binflow/domain';

import type { Database, DatabaseTransaction } from './client.js';
import { auditEvents } from './schema.js';

declare const scopedDatabaseBrand: unique symbol;

export type DatabaseExecutionScope =
  | Readonly<{ kind: 'tenant'; tenantId: string }>
  | Readonly<{
      actorId: string;
      correlationId: string;
      kind: 'platform_owner';
      reason: string;
    }>
  | Readonly<{
      kind: 'system';
      operation: string;
      tenantId: string;
    }>
  | Readonly<{
      kind: 'platform_system';
      operation: string;
    }>;

export type ScopedDatabase = DatabaseTransaction & {
  readonly [scopedDatabaseBrand]: DatabaseExecutionScope;
};

const validateText = (value: string, field: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainError('validation_error', `${field} is required.`);
  }
  return normalized;
};

const applyTenantSettings = async (
  transaction: DatabaseTransaction,
  tenantId: string,
): Promise<void> => {
  await transaction.execute(
    sql`select set_config('app.tenant_id', ${tenantId}, true)`,
  );
  await transaction.execute(
    sql`select set_config('app.platform_owner', 'false', true)`,
  );
};

export const withTenantScope = async <T>(
  database: Database,
  tenantId: string,
  action: (database: ScopedDatabase) => Promise<T>,
): Promise<T> => {
  const normalizedTenantId = validateText(tenantId, 'tenantId');
  return database.transaction(async (transaction) => {
    await applyTenantSettings(transaction, normalizedTenantId);
    return action(transaction as ScopedDatabase);
  });
};

export const withSystemTenantScope = async <T>(
  database: Database,
  input: Readonly<{ operation: string; tenantId: string }>,
  action: (database: ScopedDatabase) => Promise<T>,
): Promise<T> => {
  const operation = validateText(input.operation, 'operation');
  const tenantId = validateText(input.tenantId, 'tenantId');
  return database.transaction(async (transaction) => {
    await applyTenantSettings(transaction, tenantId);
    await transaction.execute(
      sql`select set_config('app.system_operation', ${operation}, true)`,
    );
    return action(
      transaction as ScopedDatabase & {
        readonly [scopedDatabaseBrand]: {
          kind: 'system';
          operation: string;
          tenantId: string;
        };
      },
    );
  });
};

export const withPlatformOwnerScope = async <T>(
  database: Database,
  input: Readonly<{
    actorId: string;
    correlationId: string;
    reason: string;
  }>,
  action: (database: ScopedDatabase) => Promise<T>,
): Promise<T> => {
  const actorId = validateText(input.actorId, 'actorId');
  const correlationId = validateText(input.correlationId, 'correlationId');
  const reason = validateText(input.reason, 'reason');
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.tenant_id', '', true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_owner', 'true', true)`,
    );
    await transaction.insert(auditEvents).values({
      action: 'platform.scope_accessed',
      actorId,
      actorType: 'platform_owner',
      correlationId,
      id: uuidv7(),
      metadata: {},
      objectId: 'platform',
      objectType: 'database_scope',
      reason,
    });
    return action(transaction as ScopedDatabase);
  });
};

export const withPlatformSystemScope = async <T>(
  database: Database,
  operation: string,
  action: (database: ScopedDatabase) => Promise<T>,
): Promise<T> => {
  const normalizedOperation = validateText(operation, 'operation');
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.tenant_id', '', true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_owner', 'true', true)`,
    );
    await transaction.execute(
      sql`select set_config('app.system_operation', ${normalizedOperation}, true)`,
    );
    return action(transaction as ScopedDatabase);
  });
};
