import { describe, expect, it } from 'vitest';

import {
  formatTicketRelativeTime,
  HOME_RECENT_TICKET_LIMIT,
  pendingStatesForTab,
  takeRecentTickets,
  ticketIsUnread,
  ticketListSearchParams,
  ticketStateBadgeColor,
  ticketStateLabel,
  ticketTabForState,
} from '../app/lib/ticket-inbox';

describe('ticket inbox helpers', () => {
  it('maps states to tabs, labels, and badge colors', () => {
    expect(ticketTabForState('new')).toBe('pending');
    expect(ticketTabForState('in_process')).toBe('pending');
    expect(ticketTabForState('declined')).toBe('history');
    expect(ticketTabForState('closed')).toBe('history');
    expect(pendingStatesForTab('pending')).toEqual(['new', 'in_process']);
    expect(pendingStatesForTab('history')).toEqual(['declined', 'closed']);
    expect(ticketStateLabel('in_process')).toBe('In progress');
    expect(ticketStateBadgeColor('new')).toBe('primary');
    expect(ticketStateBadgeColor('closed')).toBe('success');
  });

  it('detects unread and builds list search params', () => {
    expect(ticketIsUnread({ readAt: null })).toBe(true);
    expect(ticketIsUnread({ readAt: '2026-08-31T12:00:00.000Z' })).toBe(false);
    expect(
      ticketListSearchParams({
        limit: 10,
        projectId: 'project-1',
        state: 'new',
        tab: 'pending',
      }),
    ).toBe('tab=pending&limit=10&projectId=project-1&state=new');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-08-31T12:00:00.000Z');
    expect(
      formatTicketRelativeTime('2026-08-31T11:59:00.000Z', now),
    ).toContain('minute');
  });

  it('takes the newest home ticket strip', () => {
    expect(takeRecentTickets([1, 2, 3, 4, 5], HOME_RECENT_TICKET_LIMIT)).toEqual(
      [1, 2, 3, 4],
    );
    expect(
      ticketListSearchParams({
        limit: 10,
        tab: 'all',
      }),
    ).toBe('tab=all&limit=10');
  });
});
