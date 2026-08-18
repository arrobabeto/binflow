import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { DomainError, type ErrorCategory } from '@binflow/domain';

import type { ScopedDatabase } from './scope.js';
import {
  adminOperations,
  auditEvents,
  idempotencyRecords,
  outboxEvents,
  processedEvents,
} from './schema.js';

type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

const canonicalize = (value: JsonValue): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${(value as readonly JsonValue[])
      .map((item) => canonicalize(item))
      .join(',')}]`;
  }
  const entries = Object.entries(
    value as Readonly<Record<string, JsonValue>>,
  ).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(',')}}`;
};

export const hashCanonicalRequest = (value: JsonValue): string =>
  createHash('sha256').update(canonicalize(value)).digest('hex');

export type IdempotencyReservation =
  | Readonly<{ id: string; kind: 'reserved' }>
  | Readonly<{
      kind: 'replay';
      operationId: string | null;
      responseBody: unknown;
      responseStatus: number | null;
      status: 'processing' | 'completed' | 'failed';
    }>;

export const reserveIdempotencyKey = async (
  database: ScopedDatabase,
  input: Readonly<{
    actorId: string;
    expiresAt: Date;
    idempotencyKey: string;
    method: string;
    projectId?: string;
    requestHash: string;
    route: string;
    tenantId?: string;
  }>,
): Promise<IdempotencyReservation> => {
  const id = uuidv7();
  const inserted = await database
    .insert(idempotencyRecords)
    .values({
      actorId: input.actorId,
      expiresAt: input.expiresAt,
      id,
      idempotencyKey: input.idempotencyKey,
      method: input.method.toUpperCase(),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      requestHash: input.requestHash,
      route: input.route,
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyRecords.id });
  if (inserted.length > 0) return { id, kind: 'reserved' };

  const existing = await database.query.idempotencyRecords.findFirst({
    where: and(
      eq(idempotencyRecords.actorId, input.actorId),
      eq(idempotencyRecords.method, input.method.toUpperCase()),
      eq(idempotencyRecords.route, input.route),
      eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
    ),
  });
  if (existing === undefined) {
    throw new DomainError(
      'internal_error',
      'Idempotency reservation could not be reconciled.',
    );
  }
  if (existing.requestHash !== input.requestHash) {
    throw new DomainError(
      'conflict_error',
      'The idempotency key was already used for a different request.',
    );
  }
  return {
    kind: 'replay',
    operationId: existing.operationId,
    responseBody: existing.responseBody,
    responseStatus: existing.responseStatus,
    status: existing.status,
  };
};

export const completeIdempotencyRecord = async (
  database: ScopedDatabase,
  input: Readonly<{
    id: string;
    operationId?: string;
    responseBody: JsonValue;
    responseStatus: number;
    status: 'completed' | 'failed';
  }>,
): Promise<void> => {
  const updated = await database
    .update(idempotencyRecords)
    .set({
      ...(input.operationId === undefined
        ? {}
        : { operationId: input.operationId }),
      responseBody: input.responseBody,
      responseStatus: input.responseStatus,
      status: input.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(idempotencyRecords.id, input.id),
        eq(idempotencyRecords.status, 'processing'),
      ),
    )
    .returning({ id: idempotencyRecords.id });
  if (updated.length !== 1) {
    throw new DomainError(
      'conflict_error',
      'The idempotency record is no longer processing.',
    );
  }
};

export const createAdminOperation = async (
  database: ScopedDatabase,
  input: Readonly<{
    actorId: string;
    aggregateId: string;
    aggregateType: string;
    auditAction: string;
    correlationId: string;
    eventType: string;
    inputHash: string;
    payload: Readonly<Record<string, JsonValue>>;
    projectId?: string;
    reason?: string;
    tenantId?: string;
    type: string;
  }>,
): Promise<Readonly<{ operationId: string; outboxEventId: string }>> => {
  const operationId = uuidv7();
  const outboxEventId = uuidv7();
  const scope = {
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
  };
  await database.insert(adminOperations).values({
    actorId: input.actorId,
    id: operationId,
    inputHash: input.inputHash,
    ...scope,
    type: input.type,
  });
  await database.insert(auditEvents).values({
    action: input.auditAction,
    actorId: input.actorId,
    actorType: 'platform_owner',
    correlationId: input.correlationId,
    id: uuidv7(),
    metadata: { operationId },
    objectId: input.aggregateId,
    objectType: input.aggregateType,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...scope,
  });
  await database.insert(outboxEvents).values({
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
    eventType: input.eventType,
    eventVersion: 1,
    id: outboxEventId,
    jobKey: `admin-operation:${operationId}`,
    payload: { ...input.payload, operationId },
    ...scope,
  });
  return { operationId, outboxEventId };
};

export const recordProcessedEvent = async (
  database: ScopedDatabase,
  input: Readonly<{
    consumer: string;
    eventKey: string;
    projectId?: string;
    result: JsonValue;
    tenantId?: string;
  }>,
): Promise<'processed' | 'duplicate'> => {
  const now = new Date();
  const inserted = await database
    .insert(processedEvents)
    .values({
      consumer: input.consumer,
      eventKey: input.eventKey,
      firstSeenAt: now,
      id: uuidv7(),
      lastSeenAt: now,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      result: input.result,
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    })
    .onConflictDoNothing()
    .returning({ id: processedEvents.id });
  if (inserted.length > 0) return 'processed';
  await database
    .update(processedEvents)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(processedEvents.consumer, input.consumer),
        eq(processedEvents.eventKey, input.eventKey),
      ),
    );
  return 'duplicate';
};

const allowedOperationTransitions = {
  pending: new Set(['running', 'failed', 'cancelled']),
  running: new Set(['succeeded', 'failed', 'cancelled']),
  succeeded: new Set<string>(),
  failed: new Set<string>(),
  cancelled: new Set<string>(),
} as const;

export const transitionAdminOperation = async (
  database: ScopedDatabase,
  input: Readonly<{
    error?: Readonly<{ category: ErrorCategory; code: string }>;
    expectedVersion: number;
    operationId: string;
    progress: number;
    result?: Readonly<Record<string, JsonValue>>;
    status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  }>,
): Promise<void> => {
  if (
    !Number.isInteger(input.progress) ||
    input.progress < 0 ||
    input.progress > 100
  ) {
    throw new DomainError('validation_error', 'Operation progress is invalid.');
  }
  const current = await database.query.adminOperations.findFirst({
    where: eq(adminOperations.id, input.operationId),
  });
  if (current?.version !== input.expectedVersion) {
    throw new DomainError(
      'conflict_error',
      'The administrative operation version is stale.',
    );
  }
  if (!allowedOperationTransitions[current.status].has(input.status)) {
    throw new DomainError(
      'conflict_error',
      `Administrative operation cannot transition from ${current.status} to ${input.status}.`,
    );
  }
  if (input.status === 'succeeded' && input.progress !== 100) {
    throw new DomainError(
      'validation_error',
      'A successful operation must report 100 percent progress.',
    );
  }
  if (input.status === 'failed' && input.error === undefined) {
    throw new DomainError(
      'validation_error',
      'A failed operation requires a stable error.',
    );
  }
  if (input.status !== 'failed' && input.error !== undefined) {
    throw new DomainError(
      'validation_error',
      'Only a failed operation may include an error.',
    );
  }
  const now = new Date();
  const updated = await database
    .update(adminOperations)
    .set({
      ...(input.status === 'running' && current.startedAt === null
        ? { startedAt: now }
        : {}),
      ...(input.status === 'running' ? {} : { completedAt: now }),
      errorCategory: input.error?.category ?? null,
      errorCode: input.error?.code ?? null,
      progress: input.progress,
      ...(input.result === undefined ? {} : { result: input.result }),
      status: input.status,
      updatedAt: now,
      version: sql`${adminOperations.version} + 1`,
    })
    .where(
      and(
        eq(adminOperations.id, input.operationId),
        eq(adminOperations.version, input.expectedVersion),
        eq(adminOperations.status, current.status),
      ),
    )
    .returning({ id: adminOperations.id });
  if (updated.length !== 1) {
    throw new DomainError(
      'conflict_error',
      'The administrative operation changed concurrently.',
    );
  }
};
