import type {
  Enrollment,
  TicketState,
  TicketSummary,
  ticketListPageSizes,
} from '@binflow/contracts';

import {
  allRequestInboxClients,
  formatClientKeyLabel,
  requestInboxProjectFilter,
  type RequestInboxClientOption,
} from './request-inbox';

export type TicketInboxPageSize = (typeof ticketListPageSizes)[number];

export type TicketInboxTab = 'pending' | 'history';

export type TicketListTab = TicketInboxTab | 'all';

export { allRequestInboxClients, requestInboxProjectFilter };

const operationalEnrollmentStates = new Set<Enrollment['state']>([
  'active',
  'revalidation_required',
]);

export const ticketInboxClientOptions = (
  enrollments: readonly Enrollment[],
  tickets: readonly Pick<TicketSummary, 'clientName' | 'projectId'>[],
): RequestInboxClientOption[] => {
  const options = new Map<string, string>();
  for (const enrollment of enrollments) {
    if (!operationalEnrollmentStates.has(enrollment.state)) continue;
    options.set(
      enrollment.projectId,
      formatClientKeyLabel(enrollment.tenantKey),
    );
  }
  for (const ticket of tickets) {
    if (!options.has(ticket.projectId))
      options.set(ticket.projectId, ticket.clientName);
  }
  return [...options.entries()]
    .map(([projectId, label]) => ({ label, projectId }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

export const ticketListSearchParams = (input: {
  cursor?: string;
  limit: TicketInboxPageSize;
  projectId?: string;
  state?: TicketState | 'all';
  tab: TicketListTab;
}): string => {
  const params = new URLSearchParams();
  params.set('tab', input.tab);
  params.set('limit', String(input.limit));
  if (input.projectId !== undefined) params.set('projectId', input.projectId);
  if (input.state !== undefined && input.state !== 'all')
    params.set('state', input.state);
  if (input.cursor !== undefined && input.cursor.length > 0)
    params.set('cursor', input.cursor);
  return params.toString();
};

export const ticketStateLabel = (state: TicketState): string => {
  switch (state) {
    case 'new':
      return 'New';
    case 'in_process':
      return 'In progress';
    case 'declined':
      return 'Declined';
    case 'closed':
      return 'Closed';
  }
};

export const ticketStateBadgeColor = (
  state: TicketState,
): 'primary' | 'warning' | 'error' | 'success' | 'neutral' => {
  switch (state) {
    case 'new':
      return 'primary';
    case 'in_process':
      return 'warning';
    case 'declined':
      return 'error';
    case 'closed':
      return 'success';
  }
};

export const ticketIsUnread = (
  ticket: Pick<TicketSummary, 'readAt'>,
): boolean => ticket.readAt === null;

export const ticketTabForState = (state: TicketState): TicketInboxTab =>
  state === 'new' || state === 'in_process' ? 'pending' : 'history';

export const pendingStatesForTab = (
  tab: TicketInboxTab,
): readonly TicketState[] =>
  tab === 'pending' ? ['new', 'in_process'] : ['declined', 'closed'];

export const formatTicketRelativeTime = (
  iso: string,
  nowMs = Date.now(),
): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const deltaSec = Math.round((then - nowMs) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(deltaSec, 'second');
  const deltaMin = Math.round(deltaSec / 60);
  if (Math.abs(deltaMin) < 60) return rtf.format(deltaMin, 'minute');
  const deltaHour = Math.round(deltaMin / 60);
  if (Math.abs(deltaHour) < 48) return rtf.format(deltaHour, 'hour');
  const deltaDay = Math.round(deltaHour / 24);
  return rtf.format(deltaDay, 'day');
};

/** Newest tickets for the Home strip (API already orders by updatedAt desc). */
export const HOME_RECENT_TICKET_LIMIT = 4 as const;

export const takeRecentTickets = <T>(
  items: readonly T[],
  limit = HOME_RECENT_TICKET_LIMIT,
): T[] => items.slice(0, limit);
