import type {
  CredentialSummary,
  Enrollment,
  EnrollmentState,
  HealthResponse,
  RequestSummary,
} from '@binflow/contracts';

import { formatClientKeyLabel } from './request-inbox';

export type ApproximateCount = Readonly<{
  approximate: boolean;
  value: number;
}>;

export type ClientMix = Readonly<{
  active: number;
  attention: number;
  total: number;
}>;

export type ClientSummaryModel = Readonly<{
  canMessage: boolean;
  currentStep: number;
  id: string;
  label: string;
  pendingApprovals: number;
  projectId: string;
  projectKey: string;
  requestsToday: number;
  showEnrollmentStep: boolean;
  state: EnrollmentState;
}>;

export type AttentionItem = Readonly<{
  href: string;
  id: string;
  label: string;
}>;

export type SystemHealthLabel = Readonly<{
  detail: string;
  ready: boolean;
  status: string;
}>;

const operationalStates = new Set<EnrollmentState>([
  'active',
  'revalidation_required',
]);

const attentionEnrollmentStates = new Set<EnrollmentState>([
  'validation_failed',
  'pairing_pending',
  'revalidation_required',
  'suspended',
]);

const utcDayKey = (iso: string): string => iso.slice(0, 10);

export const formatApproximateCount = (count: ApproximateCount): string =>
  count.approximate ? `${String(count.value)}+` : String(count.value);

export const summarizeClientMix = (
  enrollments: readonly Enrollment[],
): ClientMix => {
  let active = 0;
  let attention = 0;
  for (const enrollment of enrollments) {
    if (operationalStates.has(enrollment.state)) active += 1;
    if (attentionEnrollmentStates.has(enrollment.state)) attention += 1;
  }
  return { active, attention, total: enrollments.length };
};

export const countPendingApprovals = (
  items: readonly RequestSummary[],
  nextCursor: string | null | undefined,
): ApproximateCount => ({
  approximate: nextCursor != null && nextCursor.length > 0,
  value: items.length,
});

/** Exact pending count from a full (or truncated) request catalog. */
export const countAwaitingAdminApproval = (
  items: readonly Pick<RequestSummary, 'state'>[],
  truncated: boolean,
): ApproximateCount => {
  const value = items.filter(
    (item) => item.state === 'AWAITING_ADMIN_APPROVAL',
  ).length;
  return { approximate: truncated && value > 0, value };
};

export const countRequestsOnUtcDay = (
  items: readonly Pick<RequestSummary, 'createdAt'>[],
  utcDay: string,
  hasMore: boolean,
): ApproximateCount => {
  const value = items.filter((item) => utcDayKey(item.createdAt) === utcDay)
    .length;
  return { approximate: hasMore && value > 0, value };
};

/** Operator wall-clock calendar day `YYYY-MM-DD` (matches the Home local clock). */
export const localDayKey = (now: Date = new Date()): string => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createdOnLocalDay = (iso: string, localDay: string): boolean => {
  const created = new Date(iso);
  return Number.isFinite(created.getTime()) && localDayKey(created) === localDay;
};

/** Count requests whose createdAt falls on the operator's local calendar day. */
export const countRequestsOnLocalDay = (
  items: readonly Pick<RequestSummary, 'createdAt'>[],
  localDay: string,
  hasMore: boolean,
): ApproximateCount => {
  const value = items.filter((item) => createdOnLocalDay(item.createdAt, localDay))
    .length;
  return { approximate: hasMore && value > 0, value };
};

export const requestsByProjectOnUtcDay = (
  items: readonly Pick<RequestSummary, 'createdAt' | 'projectId'>[],
  utcDay: string,
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (utcDayKey(item.createdAt) !== utcDay) continue;
    counts.set(item.projectId, (counts.get(item.projectId) ?? 0) + 1);
  }
  return counts;
};

export const requestsByProjectOnLocalDay = (
  items: readonly Pick<RequestSummary, 'createdAt' | 'projectId'>[],
  localDay: string,
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!createdOnLocalDay(item.createdAt, localDay)) continue;
    counts.set(item.projectId, (counts.get(item.projectId) ?? 0) + 1);
  }
  return counts;
};

export const pendingApprovalsByProject = (
  items: readonly Pick<RequestSummary, 'projectId'>[],
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.projectId, (counts.get(item.projectId) ?? 0) + 1);
  }
  return counts;
};

export const buildClientSummaries = (
  enrollments: readonly Enrollment[],
  requestsTodayByProject: ReadonlyMap<string, number>,
  pendingByProject: ReadonlyMap<string, number>,
): ClientSummaryModel[] =>
  [...enrollments]
    .map((enrollment) => ({
      canMessage: operationalStates.has(enrollment.state),
      currentStep: enrollment.currentStep,
      id: enrollment.id,
      label: formatClientKeyLabel(enrollment.tenantKey),
      pendingApprovals: pendingByProject.get(enrollment.projectId) ?? 0,
      projectId: enrollment.projectId,
      projectKey: enrollment.projectKey,
      requestsToday: requestsTodayByProject.get(enrollment.projectId) ?? 0,
      showEnrollmentStep: !operationalStates.has(enrollment.state),
      state: enrollment.state,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

export const summarizeSystemHealth = (
  health: Pick<HealthResponse, 'status'> | null | undefined,
  readiness:
    | Readonly<{ status: 'ready' | 'not_ready' }>
    | null
    | undefined,
): SystemHealthLabel => {
  const apiOk = health?.status === 'ok';
  const opsReady = readiness?.status === 'ready';
  if (health === undefined || health === null) {
    return { detail: 'Checking API…', ready: false, status: 'Checking' };
  }
  if (apiOk && opsReady) {
    return { detail: 'API and runtime ready', ready: true, status: 'Healthy' };
  }
  if (apiOk && readiness === undefined) {
    return { detail: 'API ok · readiness pending', ready: true, status: 'OK' };
  }
  if (apiOk && !opsReady) {
    return {
      detail: 'API ok · runtime not ready',
      ready: false,
      status: 'Degraded',
    };
  }
  return {
    detail: `API ${health.status}`,
    ready: false,
    status: health.status === 'degraded' ? 'Degraded' : 'Unavailable',
  };
};

export const buildAttentionItems = (input: {
  enrollments: readonly Enrollment[];
  pendingApprovals: ApproximateCount;
  credentials: readonly Pick<CredentialSummary, 'id' | 'alias' | 'status'>[];
  readinessStatus: 'ready' | 'not_ready' | null | undefined;
}): AttentionItem[] => {
  const items: AttentionItem[] = [];
  if (input.pendingApprovals.value > 0) {
    items.push({
      href: '/requests',
      id: 'pending-approvals',
      label: `${formatApproximateCount(input.pendingApprovals)} awaiting approval`,
    });
  }
  const unverified = input.credentials.filter(
    (credential) =>
      credential.status === 'unverified' || credential.status === 'invalid',
  ).length;
  if (unverified > 0) {
    items.push({
      href: '/integrations',
      id: 'credentials',
      label: `${String(unverified)} credential${unverified === 1 ? '' : 's'} need attention`,
    });
  }
  if (input.readinessStatus === 'not_ready') {
    items.push({
      href: '/operations',
      id: 'readiness',
      label: 'Runtime readiness is not ready',
    });
  }
  for (const enrollment of input.enrollments) {
    if (!attentionEnrollmentStates.has(enrollment.state)) continue;
    items.push({
      href: `/clients/${enrollment.id}`,
      id: `enrollment-${enrollment.id}`,
      label: `${formatClientKeyLabel(enrollment.tenantKey)} · ${enrollment.state.replaceAll('_', ' ')}`,
    });
  }
  return items;
};

export const utcTodayKey = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 10);
