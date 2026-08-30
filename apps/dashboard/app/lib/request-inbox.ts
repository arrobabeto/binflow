import type {
  Enrollment,
  requestListPageSizes,
  RequestSummary,
} from '@binflow/contracts';

export type RequestInboxPageSize = (typeof requestListPageSizes)[number];

export type RequestInboxClientOption = Readonly<{
  label: string;
  projectId: string;
}>;

export const defaultRequestInboxPageSize: RequestInboxPageSize = 10;

/**
 * Select items reject empty string values because the component reserves the
 * empty string for clearing the selection, so the "all clients" choice needs a
 * sentinel that never collides with a project identifier.
 */
export const allRequestInboxClients = 'all-clients';

export const requestInboxProjectFilter = (
  selected: string,
): string | undefined =>
  selected === allRequestInboxClients || selected === '' ? undefined : selected;

const operationalEnrollmentStates = new Set<Enrollment['state']>([
  'active',
  'revalidation_required',
]);

export const formatClientKeyLabel = (tenantKey: string): string =>
  tenantKey
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const requestInboxClientOptions = (
  enrollments: readonly Enrollment[],
  requests: readonly Pick<RequestSummary, 'clientName' | 'projectId'>[],
): RequestInboxClientOption[] => {
  const options = new Map<string, string>();
  for (const enrollment of enrollments) {
    if (!operationalEnrollmentStates.has(enrollment.state)) continue;
    options.set(
      enrollment.projectId,
      formatClientKeyLabel(enrollment.tenantKey),
    );
  }
  for (const request of requests) {
    options.set(request.projectId, request.clientName);
  }
  return [...options.entries()]
    .map(([projectId, label]) => ({ label, projectId }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

/** @deprecated Use {@link requestInboxClientOptions} with request summaries. */
export const activeRequestInboxClients = (
  enrollments: readonly Enrollment[],
): RequestInboxClientOption[] => requestInboxClientOptions(enrollments, []);

export const requestListSearchParams = (
  input: Readonly<{
    cursor?: string;
    limit: RequestInboxPageSize;
    needsAdminApproval: boolean;
    projectId?: string;
  }>,
): string => {
  const params = new URLSearchParams({
    limit: String(input.limit),
    needsAdminApproval: String(input.needsAdminApproval),
  });
  if (input.projectId !== undefined) params.set('projectId', input.projectId);
  if (input.cursor !== undefined) params.set('cursor', input.cursor);
  return params.toString();
};

export type RequestCardTone = 'default' | 'approved' | 'rejected';

const postAdminApprovalStates = new Set<RequestSummary['state']>([
  'APPROVED_FOR_PUBLISH',
  'REVALIDATING',
  'MERGING_OR_PUBLISHING',
  'PRODUCTION_DEPLOYING',
  'VERIFYING_PRODUCTION',
]);

/** Visual tone for inbox cards after an admin decision (or publish progress). */
export const requestCardTone = (
  request: Readonly<
    Pick<RequestSummary, 'approvalStatus' | 'state'>
  >,
): RequestCardTone => {
  if (request.approvalStatus === 'admin_rejected') return 'rejected';
  if (
    request.approvalStatus === 'approved_for_publish' ||
    request.approvalStatus === 'published'
  ) {
    return 'approved';
  }
  if (postAdminApprovalStates.has(request.state)) return 'approved';
  return 'default';
};

export const requestCardToneClass = (tone: RequestCardTone): string => {
  if (tone === 'approved')
    return 'bg-emerald-500/10 ring-1 ring-emerald-500/35';
  if (tone === 'rejected') return 'bg-rose-500/10 ring-1 ring-rose-500/35';
  return '';
};

/** Request payloads arrive as parsed JSON, so no other value kinds occur. */
const renderFieldValue = (field: unknown): string => {
  if (Array.isArray(field)) return field.map(String).join(', ');
  if (typeof field === 'object') return JSON.stringify(field);
  if (typeof field === 'string') return field;
  if (typeof field === 'number' || typeof field === 'boolean')
    return String(field);
  return '';
};

export const labeledRecordFields = (
  value: Record<string, unknown> | null | undefined,
): readonly { label: string; value: string }[] => {
  if (value === null || value === undefined) return [];
  return Object.entries(value).flatMap(([key, field]) => {
    if (field === undefined || field === null || field === '') return [];
    if (Array.isArray(field) && field.length === 0) return [];
    if (
      typeof field === 'object' &&
      !Array.isArray(field) &&
      Object.keys(field).length === 0
    )
      return [];
    return [{ label: key, value: renderFieldValue(field) }];
  });
};
