import { createHash, randomBytes } from 'node:crypto';

import { v7 as uuidv7 } from 'uuid';

import { schema, type ScopedDatabase } from '@binflow/db';
import type { Clock } from '@binflow/domain';

export const ADMIN_PLATFORM_USER_ID = 'admin:platform';
export const ADMIN_ACTION_TTL_MS = 24 * 60 * 60 * 1000;

export type AdminApprovalBindings = Readonly<{
  artifactId: string;
  deploymentId: string;
  headCommitSha: string;
  requestVersionId: string;
}>;

export type AdminActionKind = 'approve_publish' | 'reject';

export type AdminActionTokenPayload = Readonly<{
  action: AdminActionKind;
  label: string;
  token: string;
}>;

export const adminApprovalButtonLabels = {
  approve: 'Approve',
  reject: 'Reject',
} as const;

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const actionToken = (): string => randomBytes(32).toString('base64url');

const ADMIN_ACTION_PREFIX = 'admin:v1:';

export const encodeAdminAction = (
  kind: AdminActionKind,
  bindings: Pick<
    AdminApprovalBindings,
    'artifactId' | 'deploymentId' | 'headCommitSha'
  >,
): string =>
  `${ADMIN_ACTION_PREFIX}${JSON.stringify({
    artifactId: bindings.artifactId,
    deploymentId: bindings.deploymentId,
    headCommitSha: bindings.headCommitSha,
    kind,
  })}`;

export const parseAdminAction = (
  action: string,
): Readonly<{
  bindings: Pick<
    AdminApprovalBindings,
    'artifactId' | 'deploymentId' | 'headCommitSha'
  >;
  kind: AdminActionKind;
}> | null => {
  if (action.startsWith(ADMIN_ACTION_PREFIX)) {
    try {
      const parsed = JSON.parse(
        action.slice(ADMIN_ACTION_PREFIX.length),
      ) as {
        artifactId?: unknown;
        deploymentId?: unknown;
        headCommitSha?: unknown;
        kind?: unknown;
      };
      if (
        (parsed.kind === 'approve_publish' || parsed.kind === 'reject') &&
        typeof parsed.artifactId === 'string' &&
        typeof parsed.deploymentId === 'string' &&
        typeof parsed.headCommitSha === 'string'
      ) {
        return {
          bindings: {
            artifactId: parsed.artifactId,
            deploymentId: parsed.deploymentId,
            headCommitSha: parsed.headCommitSha,
          },
          kind: parsed.kind,
        };
      }
    } catch {
      return null;
    }
    return null;
  }
  const match =
    /^(approve_publish|reject):([^:]+):([^:]+):([^:]+)$/u.exec(action);
  if (match === null) return null;
  return {
    bindings: {
      artifactId: match[4]!,
      deploymentId: match[3]!,
      headCommitSha: match[2]!,
    },
    kind: match[1] as AdminActionKind,
  };
};

export async function createAdminRequestAction(
  database: ScopedDatabase,
  input: Readonly<{
    action: AdminActionKind;
    bindings: AdminApprovalBindings;
    clock: Clock;
    projectId: string;
    requestId: string;
    tenantId: string;
  }>,
): Promise<string> {
  const token = actionToken();
  await database.insert(schema.requestActions).values({
    action: encodeAdminAction(input.action, input.bindings),
    expiresAt: new Date(input.clock.now().getTime() + ADMIN_ACTION_TTL_MS),
    id: uuidv7(),
    projectId: input.projectId,
    requestId: input.requestId,
    requestVersionId: input.bindings.requestVersionId,
    tenantId: input.tenantId,
    tokenHash: digest(token),
    userId: ADMIN_PLATFORM_USER_ID,
  });
  return token;
}

export async function enqueueAdminApprovalRequired(
  database: ScopedDatabase,
  input: Readonly<{
    bindings: AdminApprovalBindings;
    clock: Clock;
    eventVersion: number;
    message: string;
    projectId: string;
    requestId: string;
    tenantId: string;
  }>,
): Promise<void> {
  const approveToken = await createAdminRequestAction(database, {
    action: 'approve_publish',
    bindings: input.bindings,
    clock: input.clock,
    projectId: input.projectId,
    requestId: input.requestId,
    tenantId: input.tenantId,
  });
  const rejectToken = await createAdminRequestAction(database, {
    action: 'reject',
    bindings: input.bindings,
    clock: input.clock,
    projectId: input.projectId,
    requestId: input.requestId,
    tenantId: input.tenantId,
  });
  const actionTokens: AdminActionTokenPayload[] = [
    {
      action: 'approve_publish',
      label: adminApprovalButtonLabels.approve,
      token: approveToken,
    },
    {
      action: 'reject',
      label: adminApprovalButtonLabels.reject,
      token: rejectToken,
    },
  ];
  await database.insert(schema.outboxEvents).values({
    aggregateId: input.requestId,
    aggregateType: 'request',
    eventType: 'admin.notification_requested',
    eventVersion: input.eventVersion,
    id: uuidv7(),
    jobKey: `admin.notification:admin_approval_required:${input.requestId}:${String(input.eventVersion)}`,
    payload: {
      actionTokens,
      message: input.message,
      notificationType: 'admin_approval_required',
      requestId: input.requestId,
    },
    projectId: input.projectId,
    tenantId: input.tenantId,
  });
}
