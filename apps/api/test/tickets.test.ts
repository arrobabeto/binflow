import { describe, expect, it, vi } from 'vitest';

import type { TicketDetail, TicketPage } from '@binflow/contracts';

import { buildApp } from '../src/app.js';

const sessionResolver = async () => ({
  actorId: 'owner-1',
  email: 'owner@example.com',
  fresh: true,
  role: 'platform_owner' as const,
  twoFactor: true,
});

const ticketSummary = {
  category: 'custom',
  clientKey: 'webbin',
  clientName: 'Webbin',
  createdAt: '2026-08-31T12:00:00.000Z',
  excerpt: 'Need a custom…',
  id: 'ticket-1',
  priority: 'high' as const,
  projectId: 'project-1',
  publicId: 'TKT-TICKET01',
  readAt: null,
  revision: 1,
  state: 'new' as const,
  title: 'Custom landing',
  updatedAt: '2026-08-31T12:00:00.000Z',
};

const ticketDetail: TicketDetail = {
  ...ticketSummary,
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
  body: 'Need a custom landing page.',
};

const ticketPage: TicketPage = {
  items: [ticketSummary],
  nextCursor: null,
  pendingCount: 1,
  totalCount: 2,
};

const createTicketService = () => ({
  get: vi.fn(async () => ticketDetail),
  getMessageTarget: vi.fn(async () => ({
    botUsername: 'ClientBot',
    clientName: 'Webbin',
    paired: true,
    projectKey: 'webbin',
    tenantKey: 'webbin',
  })),
  list: vi.fn(async () => ticketPage),
  markRead: vi.fn(async () => ({
    ...ticketDetail,
    readAt: '2026-08-31T12:01:00.000Z',
  })),
  patch: vi.fn(async () => ({
    ...ticketDetail,
    revision: 2,
    state: 'closed' as const,
  })),
  sendMessage: vi.fn(async () => ({
    notificationType: 'admin.ticket_message' as const,
    queued: true as const,
  })),
});

describe('admin tickets API', () => {
  it('lists pending tickets and marks read', async () => {
    const ticketService = createTicketService();
    const app = buildApp({
      resolvePlatformOwnerSession: sessionResolver,
      ticketService,
      trustedOrigin: 'http://localhost:3000',
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tickets?tab=pending',
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ pendingCount: 1 });
    expect(ticketService.list).toHaveBeenCalledWith(
      'owner-1',
      expect.any(String),
      expect.objectContaining({ tab: 'pending' }),
    );

    const read = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tickets/ticket-1/read',
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      readAt: '2026-08-31T12:01:00.000Z',
    });
    await app.close();
  });

  it('patches state and queues ticket messages', async () => {
    const ticketService = createTicketService();
    const app = buildApp({
      resolvePlatformOwnerSession: sessionResolver,
      ticketService,
      trustedOrigin: 'http://localhost:3000',
    });

    const patched = await app.inject({
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '0123456789abcdef',
        'if-match': '"1"',
        origin: 'http://localhost:3000',
      },
      method: 'PATCH',
      payload: { state: 'closed' },
      url: '/api/v1/admin/tickets/ticket-1',
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.headers.etag).toBe('"2"');
    expect(ticketService.patch).toHaveBeenCalledWith(
      'ticket-1',
      { state: 'closed' },
      1,
      'owner-1',
      expect.any(String),
      '0123456789abcdef',
    );

    const message = await app.inject({
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '0123456789abcdef01',
        origin: 'http://localhost:3000',
      },
      method: 'POST',
      payload: { message: 'We will follow up shortly.' },
      url: '/api/v1/admin/tickets/ticket-1/messages',
    });
    expect(message.statusCode).toBe(200);
    expect(message.json()).toEqual({
      notificationType: 'admin.ticket_message',
      queued: true,
    });
    await app.close();
  });
});
