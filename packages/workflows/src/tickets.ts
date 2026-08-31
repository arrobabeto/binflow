import { createHash } from 'node:crypto';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  adminClientMessageInputSchema,
  adminClientMessageQueuedSchema,
  clientMessageTargetSchema,
  createTicketInputSchema,
  decodeTicketListCursor,
  encodeTicketListCursor,
  patchTicketInputSchema,
  ticketDetailSchema,
  ticketPageSchema,
  ticketSummarySchema,
  type AdminClientMessageQueued,
  type ClientMessageTarget,
  type CreateTicketInput,
  type PatchTicketInput,
  type SupportedLocale,
  type TicketDetail,
  type TicketListQueryInput,
  type TicketPage,
  type TicketState,
  type TicketSummary,
} from '@binflow/contracts';
import {
  completeIdempotencyRecord,
  hashCanonicalRequest,
  reserveIdempotencyKey,
  schema,
  withPlatformOwnerScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';

const ACTION_TTL_MS = 24 * 60 * 60 * 1000;

const PENDING_STATES = ['new', 'in_process'] as const satisfies readonly TicketState[];
const HISTORY_STATES = [
  'declined',
  'closed',
] as const satisfies readonly TicketState[];

const ticketReplyPrefix = (
  locale: SupportedLocale,
  publicId: string,
): string => {
  if (locale === 'es') return `Respuesta al ticket ${publicId}:\n\n`;
  if (locale === 'de') return `Antwort auf Ticket ${publicId}:\n\n`;
  return `Reply to ticket ${publicId}:\n\n`;
};

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

const excerptFrom = (title: string, body: string, explicit?: string): string => {
  if (explicit !== undefined && explicit.trim().length > 0)
    return explicit.trim().slice(0, 500);
  const source = body.trim().length > 0 ? body.trim() : title;
  return source.slice(0, 280);
};

const publicIdFor = (id: string): string =>
  `TKT-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`;

const statesForTab = (
  tab: TicketListQueryInput['tab'],
): readonly TicketState[] | null => {
  if (tab === 'all') return null;
  return tab === 'pending' ? PENDING_STATES : HISTORY_STATES;
};

const toSummary = (
  ticket: typeof schema.tickets.$inferSelect,
  tenant: { displayName: string; key: string },
): TicketSummary =>
  ticketSummarySchema.parse({
    category: ticket.category,
    clientKey: tenant.key,
    clientName: tenant.displayName.trim() || tenant.key,
    createdAt: ticket.createdAt.toISOString(),
    excerpt: ticket.excerpt,
    id: ticket.id,
    priority: ticket.priority,
    projectId: ticket.projectId,
    publicId: ticket.publicId,
    readAt: ticket.readAt?.toISOString() ?? null,
    revision: ticket.version,
    state: ticket.state,
    title: ticket.title,
    updatedAt: ticket.updatedAt.toISOString(),
  });

export class TicketService {
  public constructor(
    private readonly database: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Internal create path for tests and future Telegram ingest. Not exposed as
   * a dashboard mutation in this slice.
   */
  public async createTicket(
    input: CreateTicketInput,
    actorId: string,
    correlationId: string,
  ): Promise<TicketSummary> {
    const parsed = createTicketInputSchema.parse(input);
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Create admin ticket' },
      async (database) => {
        const [project] = await database
          .select({
            displayName: schema.tenants.displayName,
            key: schema.tenants.key,
            projectId: schema.projects.id,
            tenantId: schema.projects.tenantId,
          })
          .from(schema.projects)
          .innerJoin(
            schema.tenants,
            eq(schema.tenants.id, schema.projects.tenantId),
          )
          .where(
            and(
              eq(schema.projects.id, parsed.projectId),
              eq(schema.projects.tenantId, parsed.tenantId),
            ),
          )
          .limit(1);
        if (project === undefined)
          throw new DomainError(
            'validation_error',
            'Project was not found for ticket create.',
            { code: 'ticket_project_not_found' },
          );
        const id = uuidv7();
        const now = this.clock.now();
        const excerpt = excerptFrom(parsed.title, parsed.body, parsed.excerpt);
        const [row] = await database
          .insert(schema.tickets)
          .values({
            adminNotes: '',
            body: parsed.body,
            category: parsed.category ?? null,
            createdAt: now,
            excerpt,
            id,
            priority: parsed.priority ?? null,
            projectId: project.projectId,
            publicId: publicIdFor(id),
            state: 'new',
            tenantId: project.tenantId,
            title: parsed.title,
            updatedAt: now,
            version: 1,
          })
          .returning();
        if (row === undefined)
          throw new DomainError(
            'conflict_error',
            'Ticket could not be created.',
            { code: 'ticket_create_failed' },
          );
        await database.insert(schema.ticketActivities).values({
          actorType: 'system',
          createdAt: now,
          id: uuidv7(),
          kind: 'created',
          projectId: row.projectId,
          summary: 'Ticket created.',
          tenantId: row.tenantId,
          ticketId: row.id,
        });
        return toSummary(row, {
          displayName: project.displayName,
          key: project.key,
        });
      },
    );
  }

  public async list(
    actorId: string,
    correlationId: string,
    query: TicketListQueryInput,
  ): Promise<TicketPage> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'List admin tickets' },
      async (database) => {
        const tabStates = statesForTab(query.tab);
        if (
          query.state !== undefined &&
          tabStates !== null &&
          !tabStates.includes(query.state)
        )
          throw new DomainError(
            'validation_error',
            'Ticket state does not belong to the selected tab.',
            { code: 'ticket_state_tab_mismatch' },
          );
        const filters = [];
        if (query.state !== undefined) {
          filters.push(eq(schema.tickets.state, query.state));
        } else if (tabStates !== null) {
          filters.push(inArray(schema.tickets.state, [...tabStates]));
        }
        if (query.projectId !== undefined)
          filters.push(eq(schema.tickets.projectId, query.projectId));
        if (query.cursor !== undefined) {
          let cursor: ReturnType<typeof decodeTicketListCursor>;
          try {
            cursor = decodeTicketListCursor(query.cursor);
          } catch {
            throw new DomainError(
              'validation_error',
              'Ticket list cursor is invalid.',
              { code: 'invalid_cursor' },
            );
          }
          filters.push(
            sql`(${schema.tickets.updatedAt}, ${schema.tickets.id}) < (${cursor.updatedAt}::timestamptz, ${cursor.id})`,
          );
        }
        const [pendingCountRow] = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.tickets)
          .where(
            and(
              inArray(schema.tickets.state, [...PENDING_STATES]),
              ...(query.projectId === undefined
                ? []
                : [eq(schema.tickets.projectId, query.projectId)]),
            ),
          );
        const [totalCountRow] = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.tickets)
          .where(
            query.projectId === undefined
              ? undefined
              : eq(schema.tickets.projectId, query.projectId),
          );
        const rows = await database
          .select({
            displayName: schema.tenants.displayName,
            key: schema.tenants.key,
            ticket: schema.tickets,
          })
          .from(schema.tickets)
          .innerJoin(
            schema.tenants,
            eq(schema.tenants.id, schema.tickets.tenantId),
          )
          .where(filters.length === 0 ? undefined : and(...filters))
          .orderBy(desc(schema.tickets.updatedAt), desc(schema.tickets.id))
          .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return ticketPageSchema.parse({
          items: page.map((row) =>
            toSummary(row.ticket, {
              displayName: row.displayName,
              key: row.key,
            }),
          ),
          nextCursor:
            last === undefined || rows.length <= query.limit
              ? null
              : encodeTicketListCursor({
                  id: last.ticket.id,
                  updatedAt: last.ticket.updatedAt.toISOString(),
                }),
          pendingCount: Number(pendingCountRow?.count ?? 0),
          totalCount: Number(totalCountRow?.count ?? 0),
        });
      },
    );
  }

  public async get(
    ticketId: string,
    actorId: string,
    correlationId: string,
  ): Promise<TicketDetail> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Read admin ticket' },
      async (database) => this.loadDetail(database, ticketId),
    );
  }

  public async patch(
    ticketId: string,
    input: PatchTicketInput,
    expectedVersion: number,
    actorId: string,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<TicketDetail> {
    const parsed = patchTicketInputSchema.parse(input);
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Patch admin ticket' },
      async (database) => {
        const route = `/api/v1/admin/tickets/${ticketId}`;
        const reserved = await reserveIdempotencyKey(database, {
          actorId,
          expiresAt: new Date(this.clock.now().getTime() + ACTION_TTL_MS),
          idempotencyKey,
          method: 'PATCH',
          requestHash: hashCanonicalRequest({
            adminNotes: parsed.adminNotes ?? null,
            expectedVersion,
            state: parsed.state ?? null,
          }),
          route,
        });
        if (reserved.kind === 'replay')
          return ticketDetailSchema.parse(reserved.responseBody);
        await database.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`ticket:${ticketId}`}))`,
        );
        const [current] = await database
          .select()
          .from(schema.tickets)
          .where(eq(schema.tickets.id, ticketId))
          .limit(1);
        if (current === undefined)
          throw new DomainError(
            'validation_error',
            'Ticket was not found.',
            { code: 'ticket_not_found' },
          );
        if (current.version !== expectedVersion)
          throw new DomainError(
            'conflict_error',
            'Ticket revision does not match If-Match.',
            { code: 'ticket_version_conflict' },
          );
        const now = this.clock.now();
        const nextState = parsed.state ?? current.state;
        const nextNotes =
          parsed.adminNotes !== undefined ? parsed.adminNotes : current.adminNotes;
        const [updated] = await database
          .update(schema.tickets)
          .set({
            adminNotes: nextNotes,
            state: nextState,
            updatedAt: now,
            version: current.version + 1,
          })
          .where(
            and(
              eq(schema.tickets.id, ticketId),
              eq(schema.tickets.version, expectedVersion),
            ),
          )
          .returning();
        if (updated === undefined)
          throw new DomainError(
            'conflict_error',
            'Ticket revision does not match If-Match.',
            { code: 'ticket_version_conflict' },
          );
        if (parsed.state !== undefined && parsed.state !== current.state) {
          await database.insert(schema.ticketActivities).values({
            actorType: 'platform_owner',
            createdAt: now,
            id: uuidv7(),
            kind: 'state_changed',
            projectId: updated.projectId,
            summary: `State changed to ${parsed.state}.`,
            tenantId: updated.tenantId,
            ticketId: updated.id,
          });
        }
        if (
          parsed.adminNotes !== undefined &&
          parsed.adminNotes !== current.adminNotes
        ) {
          await database.insert(schema.ticketActivities).values({
            actorType: 'platform_owner',
            createdAt: now,
            id: uuidv7(),
            kind: 'notes_updated',
            projectId: updated.projectId,
            summary: 'Admin notes updated.',
            tenantId: updated.tenantId,
            ticketId: updated.id,
          });
        }
        const detail = await this.loadDetail(database, ticketId);
        await completeIdempotencyRecord(database, {
          id: reserved.id,
          responseBody: detail,
          responseStatus: 200,
          status: 'completed',
        });
        return detail;
      },
    );
  }

  public async markRead(
    ticketId: string,
    actorId: string,
    correlationId: string,
  ): Promise<TicketDetail> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Mark admin ticket read' },
      async (database) => {
        const [current] = await database
          .select()
          .from(schema.tickets)
          .where(eq(schema.tickets.id, ticketId))
          .limit(1);
        if (current === undefined)
          throw new DomainError(
            'validation_error',
            'Ticket was not found.',
            { code: 'ticket_not_found' },
          );
        if (current.readAt === null) {
          const now = this.clock.now();
          await database
            .update(schema.tickets)
            .set({ readAt: now, updatedAt: now })
            .where(
              and(
                eq(schema.tickets.id, ticketId),
                sql`${schema.tickets.readAt} is null`,
              ),
            );
          await database.insert(schema.ticketActivities).values({
            actorType: 'platform_owner',
            createdAt: now,
            id: uuidv7(),
            kind: 'read',
            projectId: current.projectId,
            summary: 'Ticket marked read.',
            tenantId: current.tenantId,
            ticketId: current.id,
          });
        }
        return this.loadDetail(database, ticketId);
      },
    );
  }

  public async getMessageTarget(
    ticketId: string,
    actorId: string,
    correlationId: string,
  ): Promise<ClientMessageTarget> {
    return withPlatformOwnerScope(
      this.database,
      {
        actorId,
        correlationId,
        reason: 'Read ticket client message target',
      },
      async (database) => this.resolveMessageTarget(database, ticketId),
    );
  }

  public async sendMessage(
    ticketId: string,
    message: string,
    actorId: string,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<AdminClientMessageQueued> {
    const body = adminClientMessageInputSchema.parse({ message }).message;
    return withPlatformOwnerScope(
      this.database,
      {
        actorId,
        correlationId,
        reason: 'Queue ticket client direct message',
      },
      async (database) => {
        const route = `/api/v1/admin/tickets/${ticketId}/messages`;
        const reserved = await reserveIdempotencyKey(database, {
          actorId,
          expiresAt: new Date(this.clock.now().getTime() + ACTION_TTL_MS),
          idempotencyKey,
          method: 'POST',
          requestHash: hashCanonicalRequest({ message: body }),
          route,
        });
        if (reserved.kind === 'replay')
          return adminClientMessageQueuedSchema.parse(reserved.responseBody);
        const [ticket] = await database
          .select({
            id: schema.tickets.id,
            projectId: schema.tickets.projectId,
            publicId: schema.tickets.publicId,
            tenantId: schema.tickets.tenantId,
            version: schema.tickets.version,
          })
          .from(schema.tickets)
          .where(eq(schema.tickets.id, ticketId))
          .limit(1);
        if (ticket === undefined)
          throw new DomainError(
            'validation_error',
            'Ticket was not found.',
            { code: 'ticket_not_found' },
          );
        const paired = await this.activeChannelForProject(
          database,
          ticket.tenantId,
          ticket.projectId,
        );
        if (paired === undefined)
          throw new DomainError(
            'conflict_error',
            'Client Telegram is not paired for this ticket.',
            { code: 'client_not_paired' },
          );
        const locale =
          (await this.projectConversationLocale(
            database,
            ticket.tenantId,
            ticket.projectId,
          )) ?? 'en';
        const notificationType = 'admin.ticket_message';
        await database.insert(schema.outboxEvents).values({
          aggregateId: ticket.id,
          aggregateType: 'ticket',
          eventType: 'client.notification_requested',
          eventVersion: ticket.version,
          id: uuidv7(),
          jobKey: `client.notification:${notificationType}:${ticket.id}:${digest(idempotencyKey)}`,
          payload: {
            message: `${ticketReplyPrefix(locale, ticket.publicId)}${body}`,
            notificationType,
            ticketId: ticket.id,
          },
          projectId: ticket.projectId,
          tenantId: ticket.tenantId,
        });
        await database.insert(schema.auditEvents).values({
          action: 'client.admin_message_queued',
          actorId,
          actorType: 'platform_owner',
          correlationId,
          id: uuidv7(),
          metadata: {
            messageLength: body.length,
            notificationType,
          },
          objectId: ticket.id,
          objectType: 'ticket',
          projectId: ticket.projectId,
          tenantId: ticket.tenantId,
        });
        await database.insert(schema.ticketActivities).values({
          actorType: 'platform_owner',
          createdAt: this.clock.now(),
          id: uuidv7(),
          kind: 'message_queued',
          projectId: ticket.projectId,
          summary: 'Client message queued.',
          tenantId: ticket.tenantId,
          ticketId: ticket.id,
        });
        const response = adminClientMessageQueuedSchema.parse({
          notificationType,
          queued: true,
        });
        await completeIdempotencyRecord(database, {
          id: reserved.id,
          responseBody: response,
          responseStatus: 200,
          status: 'completed',
        });
        return response;
      },
    );
  }

  private async loadDetail(
    database: ScopedDatabase,
    ticketId: string,
  ): Promise<TicketDetail> {
    const [row] = await database
      .select({
        displayName: schema.tenants.displayName,
        key: schema.tenants.key,
        ticket: schema.tickets,
      })
      .from(schema.tickets)
      .innerJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.tickets.tenantId),
      )
      .where(eq(schema.tickets.id, ticketId))
      .limit(1);
    if (row === undefined)
      throw new DomainError('validation_error', 'Ticket was not found.', {
        code: 'ticket_not_found',
      });
    const activity = await database
      .select()
      .from(schema.ticketActivities)
      .where(eq(schema.ticketActivities.ticketId, ticketId))
      .orderBy(asc(schema.ticketActivities.createdAt));
    const summary = toSummary(row.ticket, {
      displayName: row.displayName,
      key: row.key,
    });
    return ticketDetailSchema.parse({
      ...summary,
      activity: activity.map((item) => ({
        actorType: item.actorType as 'platform_owner' | 'system' | 'client',
        createdAt: item.createdAt.toISOString(),
        id: item.id,
        kind: item.kind,
        summary: item.summary,
      })),
      adminNotes: row.ticket.adminNotes,
      body: row.ticket.body,
    });
  }

  private async resolveMessageTarget(
    database: ScopedDatabase,
    ticketId: string,
  ): Promise<ClientMessageTarget> {
    const [row] = await database
      .select({
        configuration: schema.providerCredentials.configuration,
        displayName: schema.tenants.displayName,
        identityId: schema.channelIdentities.id,
        projectKey: schema.projects.key,
        tenantKey: schema.tenants.key,
      })
      .from(schema.tickets)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tickets.tenantId))
      .innerJoin(
        schema.projects,
        eq(schema.projects.id, schema.tickets.projectId),
      )
      .leftJoin(
        schema.channelIdentities,
        and(
          eq(schema.channelIdentities.tenantId, schema.tickets.tenantId),
          eq(schema.channelIdentities.projectId, schema.tickets.projectId),
          eq(schema.channelIdentities.status, 'active'),
        ),
      )
      .leftJoin(
        schema.providerCredentials,
        eq(
          schema.providerCredentials.id,
          schema.channelIdentities.botCredentialId,
        ),
      )
      .where(eq(schema.tickets.id, ticketId))
      .limit(1);
    if (row === undefined)
      throw new DomainError('validation_error', 'Ticket was not found.', {
        code: 'ticket_not_found',
      });
    const username = (
      row.configuration as { expectedUsername?: unknown } | null
    )?.expectedUsername;
    return clientMessageTargetSchema.parse({
      botUsername: typeof username === 'string' ? username : null,
      clientName: row.displayName.trim() || row.tenantKey,
      paired: row.identityId !== null,
      projectKey: row.projectKey,
      tenantKey: row.tenantKey,
    });
  }

  private async activeChannelForProject(
    database: ScopedDatabase,
    tenantId: string,
    projectId: string,
  ): Promise<{ botCredentialId: string } | undefined> {
    const [row] = await database
      .select({ botCredentialId: schema.channelIdentities.botCredentialId })
      .from(schema.channelIdentities)
      .where(
        and(
          eq(schema.channelIdentities.tenantId, tenantId),
          eq(schema.channelIdentities.projectId, projectId),
          eq(schema.channelIdentities.status, 'active'),
        ),
      )
      .limit(1);
    return row;
  }

  private async projectConversationLocale(
    database: ScopedDatabase,
    tenantId: string,
    projectId: string,
  ): Promise<SupportedLocale | undefined> {
    const [row] = await database
      .select({ locale: schema.conversations.locale })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.tenantId, tenantId),
          eq(schema.conversations.projectId, projectId),
        ),
      )
      .orderBy(desc(schema.conversations.lastMessageAt))
      .limit(1);
    if (row === undefined) return undefined;
    return row.locale === 'de' || row.locale === 'en' || row.locale === 'es'
      ? row.locale
      : undefined;
  }
}
