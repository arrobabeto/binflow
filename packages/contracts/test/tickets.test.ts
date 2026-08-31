import { describe, expect, it } from 'vitest';

import {
  createTicketInputSchema,
  patchTicketInputSchema,
  ticketDetailSchema,
  ticketListQuerySchema,
  ticketPageSchema,
  ticketStateSchema,
  ticketSummarySchema,
  adminClientMessageQueuedSchema,
} from '../src/index.js';

describe('ticket contracts', () => {
  it('accepts ticket states and list query defaults', () => {
    expect(ticketStateSchema.parse('in_process')).toBe('in_process');
    expect(ticketListQuerySchema.parse({})).toEqual({
      limit: 10,
      tab: 'pending',
    });
    expect(
      ticketListQuerySchema.parse({
        limit: '30',
        state: 'closed',
        tab: 'history',
      }),
    ).toMatchObject({ limit: 30, state: 'closed', tab: 'history' });
    expect(ticketListQuerySchema.parse({ tab: 'all' })).toMatchObject({
      tab: 'all',
    });
  });

  it('parses summary, detail, and page with pendingCount', () => {
    const summary = ticketSummarySchema.parse({
      category: 'custom',
      clientKey: 'webbin',
      clientName: 'Webbin',
      createdAt: '2026-08-31T12:00:00.000Z',
      excerpt: 'Need a landing…',
      id: 'ticket-1',
      priority: 'high',
      projectId: 'project-1',
      publicId: 'TKT-ABCD1234',
      readAt: null,
      revision: 1,
      state: 'new',
      title: 'Custom landing page',
      updatedAt: '2026-08-31T12:00:00.000Z',
    });
    expect(summary.readAt).toBeNull();
    expect(
      ticketDetailSchema.parse({
        ...summary,
        activity: [
          {
            actorType: 'system',
            createdAt: '2026-08-31T12:00:00.000Z',
            id: 'act-1',
            kind: 'created',
            summary: 'Ticket created.',
          },
        ],
        adminNotes: '',
        body: 'Full request body',
      }),
    ).toMatchObject({ body: 'Full request body' });
    expect(
      ticketPageSchema.parse({
        items: [summary],
        nextCursor: null,
        pendingCount: 1,
        totalCount: 4,
      }),
    ).toMatchObject({ pendingCount: 1, totalCount: 4 });
  });

  it('requires patch fields and accepts ticket message type', () => {
    expect(() => patchTicketInputSchema.parse({})).toThrow();
    expect(patchTicketInputSchema.parse({ state: 'closed' })).toEqual({
      state: 'closed',
    });
    expect(
      createTicketInputSchema.parse({
        body: 'Please build a custom form.',
        projectId: 'project-1',
        tenantId: 'tenant-1',
        title: 'Custom form',
      }),
    ).toMatchObject({ title: 'Custom form' });
    expect(
      adminClientMessageQueuedSchema.parse({
        notificationType: 'admin.ticket_message',
        queued: true,
      }),
    ).toEqual({
      notificationType: 'admin.ticket_message',
      queued: true,
    });
  });
});
