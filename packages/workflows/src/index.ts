import { createHash, randomBytes } from 'node:crypto';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  createBlogDraftInputSchema,
  requestDetailSchema,
  requestSummarySchema,
  telegramIngressSchema,
  telegramReplySchema,
  type RequestDetail,
  type RequestSummary,
  type SupportedLocale,
  type TelegramIngress,
  type TelegramReply,
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
const TERMINAL_STATES = [
  'COMPLETED',
  'FAILED_FINAL',
  'CANCELLED',
  'SUPERSEDED',
] as const;

const copy = {
  de: {
    accessDenied: 'Dieser Telegram-Benutzer ist nicht mit Binflow verbunden.',
    cancelled: 'Die Anfrage wurde abgebrochen.',
    cancelPrompt:
      'Bestätige, dass du die letzte aktive Anfrage abbrechen möchtest.',
    confirm: 'Entwurf erstellen',
    cancel: 'Abbrechen',
    duplicate: 'Diese Nachricht wurde bereits verarbeitet.',
    guidance:
      'Erstelle einen zweisprachigen Blogbeitrag. Erforderlich: ein Thema. Optional: Ziel, Zielgruppe, Kategorie, Quellen, Keywords, Datum und Bild. Beispiel: /create_blog KI-Automatisierung für kleine Unternehmen.',
    help: 'Befehle: /tools, /create_blog <Thema>, /status, /cancel und /help.',
    noRequests: 'Es gibt noch keine Anfragen.',
    paired: 'Verbindung hergestellt. Du kannst jetzt /tools verwenden.',
    plan: (topic: string) =>
      `Plan bereit für „${topic}“: Katalog prüfen, auf Ähnlichkeit testen, auf Spanisch erstellen, ins Englische übersetzen, Bild vorbereiten und eine Vorschau bauen.`,
    queued:
      'Plan bestätigt. Die Anfrage wurde sicher in die Warteschlange gestellt.',
    status: (state: string, topic: string) =>
      `Letzte Anfrage: ${topic} — ${state}.`,
    tools:
      'Verfügbare Tools:\n/create_blog — zweisprachigen Blogbeitrag erstellen',
    unknown: 'Ich konnte keine verfügbare Aktion erkennen. Verwende /help.',
  },
  en: {
    accessDenied: 'This Telegram user is not paired with Binflow.',
    cancelled: 'The request was cancelled.',
    cancelPrompt: 'Confirm that you want to cancel the latest active request.',
    confirm: 'Create draft',
    cancel: 'Cancel',
    duplicate: 'This message was already processed.',
    guidance:
      'Create a bilingual blog post. Required: one topic. Optional: objective, audience, category, sources, keywords, date and image. Example: /create_blog AI automation for small businesses.',
    help: 'Commands: /tools, /create_blog <topic>, /status, /cancel and /help.',
    noRequests: 'There are no requests yet.',
    paired: 'Pairing complete. You can now use /tools.',
    plan: (topic: string) =>
      `Plan ready for “${topic}”: sync the catalog, check similarity, write in Spanish, translate to English, prepare the image and build a preview.`,
    queued: 'Plan confirmed. The request was queued safely.',
    status: (state: string, topic: string) =>
      `Latest request: ${topic} — ${state}.`,
    tools: 'Available tools:\n/create_blog — create a bilingual blog post',
    unknown: 'I could not match that to an available action. Use /help.',
  },
  es: {
    accessDenied: 'Este usuario de Telegram no está vinculado con Binflow.',
    cancelled: 'La solicitud fue cancelada.',
    cancelPrompt:
      'Confirma que quieres cancelar la solicitud activa más reciente.',
    confirm: 'Crear borrador',
    cancel: 'Cancelar',
    duplicate: 'Este mensaje ya fue procesado.',
    guidance:
      'Crea un blog bilingüe. Requerido: un tema. Opcional: objetivo, audiencia, categoría, fuentes, palabras clave, fecha e imagen. Ejemplo: /create_blog Automatización con IA para pequeñas empresas.',
    help: 'Comandos: /tools, /create_blog <tema>, /status, /cancel y /help.',
    noRequests: 'Todavía no hay solicitudes.',
    paired: 'Vinculación completada. Ya puedes usar /tools.',
    plan: (topic: string) =>
      `Plan listo para “${topic}”: sincronizar catálogo, revisar similitud, redactar en español, traducir a inglés, preparar imagen y construir preview.`,
    queued: 'Plan confirmado. La solicitud quedó encolada de forma segura.',
    status: (state: string, topic: string) =>
      `Última solicitud: ${topic} — ${state}.`,
    tools: 'Tools disponibles:\n/create_blog — crear un blog bilingüe',
    unknown: 'No pude asociar el mensaje a una acción disponible. Usa /help.',
  },
} as const;

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const actionToken = (): string => randomBytes(32).toString('base64url');

type ResolvedIdentity = Readonly<{
  conversationId: string;
  locale: SupportedLocale;
  projectId: string;
  tenantId: string;
  userId: string;
}>;

const toSummary = (row: typeof schema.requests.$inferSelect): RequestSummary =>
  requestSummarySchema.parse({
    capabilityId: row.capabilityId,
    createdAt: row.createdAt.toISOString(),
    currentVersion: row.currentVersion,
    id: row.id,
    projectId: row.projectId,
    revision: row.version,
    state: row.state,
    tenantId: row.tenantId,
    topic: row.topic,
    updatedAt: row.updatedAt.toISOString(),
  });

export class WorkflowService {
  public constructor(
    private readonly database: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  public async handleTelegramUpdate(
    raw: TelegramIngress,
  ): Promise<TelegramReply> {
    const update = telegramIngressSchema.parse(raw);
    return withPlatformOwnerScope(
      this.database,
      {
        actorId: `telegram:${update.botId}`,
        correlationId: `telegram:${update.botId}:${update.updateId}`,
        reason: 'Handle normalized Telegram update',
      },
      async (database) => {
        const startToken = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{32,})$/u.exec(
          update.text.trim(),
        )?.[1];
        if (startToken !== undefined) {
          return this.consumePairing(database, update, startToken);
        }

        const identity = await this.resolveIdentity(database, update);
        if (identity === undefined) {
          return telegramReplySchema.parse({
            actionTokens: [],
            duplicate: false,
            locale: 'en',
            requestId: null,
            text: copy.en.accessDenied,
          });
        }

        const inserted = await database
          .insert(schema.channelMessages)
          .values({
            botId: update.botId,
            contentDigest: digest(update.text),
            conversationId: identity.conversationId,
            direction: 'inbound',
            externalUpdateId: update.updateId,
            id: uuidv7(),
            kind: update.text.startsWith('/') ? 'command' : 'text',
            projectId: identity.projectId,
            receivedAt: new Date(update.receivedAt),
            tenantId: identity.tenantId,
          })
          .onConflictDoNothing()
          .returning({ id: schema.channelMessages.id });
        if (inserted.length === 0) {
          return this.reply(
            identity.locale,
            copy[identity.locale].duplicate,
            null,
            [],
            true,
          );
        }
        await database
          .update(schema.channelIdentities)
          .set({ lastSeenAt: this.clock.now() })
          .where(
            and(
              eq(schema.channelIdentities.botId, update.botId),
              eq(
                schema.channelIdentities.externalUserId,
                update.externalUserId,
              ),
            ),
          );

        return this.route(database, identity, update.text.trim());
      },
    );
  }

  public async list(
    actorId: string,
    correlationId: string,
  ): Promise<RequestSummary[]> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'List workflow requests' },
      async (database) =>
        (
          await database
            .select()
            .from(schema.requests)
            .orderBy(desc(schema.requests.updatedAt))
            .limit(100)
        ).map(toSummary),
    );
  }

  public async get(
    requestId: string,
    actorId: string,
    correlationId: string,
  ): Promise<RequestDetail> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Read workflow request' },
      async (database) => {
        const [row] = await database
          .select({
            request: schema.requests,
            requestVersion: schema.requestVersions,
          })
          .from(schema.requests)
          .leftJoin(
            schema.requestVersions,
            and(
              eq(schema.requestVersions.requestId, schema.requests.id),
              eq(
                schema.requestVersions.version,
                schema.requests.currentVersion,
              ),
            ),
          )
          .where(eq(schema.requests.id, requestId))
          .limit(1);
        if (row === undefined)
          throw new DomainError('validation_error', 'Request was not found.', {
            code: 'request_not_found',
          });
        return requestDetailSchema.parse({
          ...toSummary(row.request),
          confirmedAt: row.requestVersion?.confirmedAt?.toISOString() ?? null,
          interpretedInput: row.requestVersion?.interpretedInput ?? null,
          plan: row.requestVersion?.plan ?? null,
        });
      },
    );
  }

  public async cancelAsAdmin(
    requestId: string,
    expectedVersion: number,
    actorId: string,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<RequestSummary> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Cancel workflow request' },
      async (database) => {
        const reserved = await reserveIdempotencyKey(database, {
          actorId,
          expiresAt: new Date(this.clock.now().getTime() + ACTION_TTL_MS),
          idempotencyKey,
          method: 'POST',
          requestHash: hashCanonicalRequest({ expectedVersion }),
          route: `/api/v1/requests/${requestId}/cancel`,
        });
        if (reserved.kind === 'replay')
          return requestSummarySchema.parse(reserved.responseBody);
        const now = this.clock.now();
        const [row] = await database
          .update(schema.requests)
          .set({
            state: 'CANCELLED',
            updatedAt: now,
            version: expectedVersion + 1,
          })
          .where(
            and(
              eq(schema.requests.id, requestId),
              eq(schema.requests.version, expectedVersion),
              sql`${schema.requests.state} NOT IN ('COMPLETED', 'FAILED_FINAL', 'CANCELLED', 'SUPERSEDED')`,
            ),
          )
          .returning();
        if (row === undefined)
          throw new DomainError(
            'conflict_error',
            'Request cannot be cancelled.',
            {
              code: 'stale_or_terminal_request',
            },
          );
        await this.recordRequestEvent(
          database,
          row,
          actorId,
          correlationId,
          'request.cancelled',
        );
        const summary = toSummary(row);
        await completeIdempotencyRecord(database, {
          id: reserved.id,
          responseBody: summary,
          responseStatus: 200,
          status: 'completed',
        });
        return summary;
      },
    );
  }

  private async consumePairing(
    database: ScopedDatabase,
    update: TelegramIngress,
    token: string,
  ): Promise<TelegramReply> {
    const now = this.clock.now();
    const [bot] = await database
      .select({ id: schema.providerCredentials.id })
      .from(schema.providerCredentials)
      .where(
        and(
          eq(schema.providerCredentials.kind, 'telegram-client'),
          eq(schema.providerCredentials.status, 'active'),
          eq(schema.providerCredentials.externalResourceId, update.botId),
        ),
      )
      .limit(1);
    if (bot === undefined) return this.reply('en', copy.en.accessDenied, null);
    const [pairing] = await database
      .select()
      .from(schema.pairingTokens)
      .where(
        and(
          eq(schema.pairingTokens.tokenHash, digest(token)),
          eq(schema.pairingTokens.botCredentialId, bot.id),
          isNull(schema.pairingTokens.consumedAt),
          isNull(schema.pairingTokens.revokedAt),
          sql`${schema.pairingTokens.expiresAt} > ${now}`,
          sql`${schema.pairingTokens.userId} IS NOT NULL`,
        ),
      )
      .limit(1);
    if (pairing?.userId === null || pairing === undefined)
      return this.reply('en', copy.en.accessDenied, null);

    const [enrollment] = await database
      .select()
      .from(schema.clientEnrollments)
      .where(eq(schema.clientEnrollments.id, pairing.enrollmentId))
      .limit(1);
    const locale =
      enrollment?.configuration.clientConversationLocale ?? ('en' as const);
    if (enrollment?.state !== 'pairing_pending')
      return this.reply(locale, copy[locale].accessDenied, null);

    const consumed = await database
      .update(schema.pairingTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.pairingTokens.id, pairing.id),
          isNull(schema.pairingTokens.consumedAt),
        ),
      )
      .returning({ id: schema.pairingTokens.id });
    if (consumed.length !== 1)
      return this.reply(locale, copy[locale].accessDenied, null);

    const identityId = uuidv7();
    await database.insert(schema.channelIdentities).values({
      botCredentialId: bot.id,
      botId: update.botId,
      chatId: update.chatId,
      externalUserId: update.externalUserId,
      id: identityId,
      lastSeenAt: now,
      projectId: pairing.projectId,
      tenantId: pairing.tenantId,
      userId: pairing.userId,
      verifiedAt: now,
    });
    await database
      .update(schema.clientUsers)
      .set({ status: 'active', updatedAt: now })
      .where(eq(schema.clientUsers.id, pairing.userId));
    await database
      .update(schema.memberships)
      .set({ status: 'active', updatedAt: now })
      .where(eq(schema.memberships.userId, pairing.userId));
    const conversationId = uuidv7();
    await database.insert(schema.conversations).values({
      channelIdentityId: identityId,
      externalChatId: update.chatId,
      id: conversationId,
      lastMessageAt: now,
      locale,
      projectId: pairing.projectId,
      tenantId: pairing.tenantId,
      userId: pairing.userId,
    });
    await database.insert(schema.channelMessages).values({
      botId: update.botId,
      contentDigest: digest(update.text),
      conversationId,
      direction: 'inbound',
      externalUpdateId: update.updateId,
      id: uuidv7(),
      kind: 'pairing',
      projectId: pairing.projectId,
      receivedAt: new Date(update.receivedAt),
      tenantId: pairing.tenantId,
    });
    await database.insert(schema.enrollmentValidationAttempts).values({
      checkName: 'client_pairing',
      checkVersion: 1,
      checkedAt: now,
      dependencyFingerprint: digest(`${bot.id}:${pairing.userId}`),
      enrollmentId: pairing.enrollmentId,
      evidence: { botId: update.botId, paired: true },
      id: uuidv7(),
      projectId: pairing.projectId,
      result: 'success',
      tenantId: pairing.tenantId,
    });
    await database.insert(schema.auditEvents).values({
      action: 'client.paired',
      actorId: pairing.userId,
      actorType: 'telegram_client',
      correlationId: `telegram:${update.botId}:${update.updateId}`,
      id: uuidv7(),
      metadata: { botId: update.botId },
      objectId: pairing.userId,
      objectType: 'client_user',
      projectId: pairing.projectId,
      tenantId: pairing.tenantId,
    });
    return this.reply(locale, copy[locale].paired, null);
  }

  private async resolveIdentity(
    database: ScopedDatabase,
    update: TelegramIngress,
  ): Promise<ResolvedIdentity | undefined> {
    const [row] = await database
      .select({
        identity: schema.channelIdentities,
        conversation: schema.conversations,
      })
      .from(schema.channelIdentities)
      .innerJoin(
        schema.conversations,
        eq(schema.conversations.channelIdentityId, schema.channelIdentities.id),
      )
      .where(
        and(
          eq(schema.channelIdentities.botId, update.botId),
          eq(schema.channelIdentities.externalUserId, update.externalUserId),
          eq(schema.channelIdentities.chatId, update.chatId),
          eq(schema.channelIdentities.status, 'active'),
        ),
      )
      .limit(1);
    if (row === undefined) return undefined;
    return {
      conversationId: row.conversation.id,
      locale: row.conversation.locale,
      projectId: row.identity.projectId,
      tenantId: row.identity.tenantId,
      userId: row.identity.userId,
    };
  }

  private async route(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    text: string,
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    if (/^\/help(?:@\w+)?$/u.test(text) || /^\/start(?:@\w+)?$/u.test(text))
      return this.reply(identity.locale, localeCopy.help, null);
    if (/^\/tools(?:@\w+)?$/u.test(text)) {
      const enabled = await this.hasCapability(database, identity.projectId);
      return this.reply(
        identity.locale,
        enabled ? localeCopy.tools : localeCopy.accessDenied,
        null,
      );
    }
    if (/^\/status(?:@\w+)?$/u.test(text)) {
      const latest = await this.latestRequest(database, identity);
      return this.reply(
        identity.locale,
        latest === undefined
          ? localeCopy.noRequests
          : localeCopy.status(latest.state, latest.topic ?? '—'),
        latest?.id ?? null,
      );
    }
    if (/^\/cancel(?:@\w+)?$/u.test(text)) {
      const latest = await this.latestRequest(database, identity, true);
      if (latest === undefined)
        return this.reply(identity.locale, localeCopy.noRequests, null);
      const version = await this.currentRequestVersion(database, latest);
      const token = await this.createAction(
        database,
        latest,
        version.id,
        identity.userId,
        'cancel',
      );
      return this.reply(identity.locale, localeCopy.cancelPrompt, latest.id, [
        { action: 'cancel', label: localeCopy.cancel, token },
      ]);
    }
    const actionMatch = /^\/action(?:@\w+)?\s+([A-Za-z0-9_-]{32,})$/u.exec(
      text,
    );
    if (actionMatch?.[1] !== undefined)
      return this.consumeAction(database, identity, actionMatch[1]);

    const command = /^\/create_blog(?:@\w+)?(?:\s+([\s\S]+))?$/u.exec(text);
    const naturalBlog =
      /\b(blog|article|artículo|articulo|beitrag|post)\b/iu.test(text);
    if (command !== null || naturalBlog) {
      const topic = (command?.[1] ?? (naturalBlog ? text : '')).trim();
      if (topic.length === 0)
        return this.reply(identity.locale, localeCopy.guidance, null);
      return this.createRequest(database, identity, topic);
    }
    return this.reply(identity.locale, localeCopy.unknown, null);
  }

  private async createRequest(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    topic: string,
  ): Promise<TelegramReply> {
    const [manifest] = await database
      .select({ id: schema.projectManifestVersions.id })
      .from(schema.projectManifestVersions)
      .where(
        and(
          eq(schema.projectManifestVersions.projectId, identity.projectId),
          inArray(schema.projectManifestVersions.status, [
            'validated',
            'active',
          ]),
        ),
      )
      .orderBy(desc(schema.projectManifestVersions.version))
      .limit(1);
    if (
      manifest === undefined ||
      !(await this.hasCapability(database, identity.projectId))
    )
      throw new DomainError(
        'policy_denied',
        'Create blog is not enabled for this project.',
      );
    const interpretedInput = createBlogDraftInputSchema.parse({
      mode: 'brief',
      projectId: identity.projectId,
      topic,
    });
    const requestId = uuidv7();
    const requestVersionId = uuidv7();
    const plan = {
      nodes: [
        'catalog_sync',
        'similarity',
        'generate_es',
        'translate_en',
        'image',
        'preview',
      ],
      topic,
    };
    const requestRow = {
      capabilityId: 'create_blog_draft',
      conversationId: identity.conversationId,
      currentVersion: 1,
      id: requestId,
      projectId: identity.projectId,
      state: 'AWAITING_PLAN_CONFIRMATION' as const,
      tenantId: identity.tenantId,
      topic,
      userId: identity.userId,
    };
    const requestIdentity = {
      id: requestId,
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    };
    await database.insert(schema.requests).values(requestRow);
    await database.insert(schema.requestVersions).values({
      capabilityVersion: 1,
      id: requestVersionId,
      interpretedInput,
      manifestVersionId: manifest.id,
      plan,
      projectId: identity.projectId,
      requestId,
      tenantId: identity.tenantId,
      version: 1,
    });
    const confirm = await this.createAction(
      database,
      requestIdentity,
      requestVersionId,
      identity.userId,
      'confirm_plan',
    );
    const cancel = await this.createAction(
      database,
      requestIdentity,
      requestVersionId,
      identity.userId,
      'cancel',
    );
    await this.recordRequestEvent(
      database,
      requestIdentity,
      identity.userId,
      `request:${requestId}`,
      'request.created',
    );
    const localeCopy = copy[identity.locale];
    return this.reply(identity.locale, localeCopy.plan(topic), requestId, [
      { action: 'confirm_plan', label: localeCopy.confirm, token: confirm },
      { action: 'cancel', label: localeCopy.cancel, token: cancel },
    ]);
  }

  private async consumeAction(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    token: string,
  ): Promise<TelegramReply> {
    const now = this.clock.now();
    const [action] = await database
      .select()
      .from(schema.requestActions)
      .where(
        and(
          eq(schema.requestActions.tokenHash, digest(token)),
          eq(schema.requestActions.userId, identity.userId),
          isNull(schema.requestActions.consumedAt),
          isNull(schema.requestActions.revokedAt),
          sql`${schema.requestActions.expiresAt} > ${now}`,
        ),
      )
      .limit(1);
    if (action === undefined)
      throw new DomainError('conflict_error', 'Action is invalid or expired.', {
        code: 'invalid_action',
      });
    await database.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`request:${action.requestId}`}))`,
    );
    const [request] = await database
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, action.requestId))
      .limit(1);
    if (request === undefined)
      throw new DomainError('conflict_error', 'Action request is unavailable.');
    const [currentVersion] = await database
      .select()
      .from(schema.requestVersions)
      .where(
        and(
          eq(schema.requestVersions.requestId, request.id),
          eq(schema.requestVersions.version, request.currentVersion),
        ),
      )
      .limit(1);
    if (currentVersion?.id !== action.requestVersionId)
      throw new DomainError(
        'conflict_error',
        'Action targets a stale request version.',
        {
          code: 'stale_action',
        },
      );
    const consumed = await database
      .update(schema.requestActions)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.requestActions.id, action.id),
          isNull(schema.requestActions.consumedAt),
        ),
      )
      .returning({ id: schema.requestActions.id });
    if (consumed.length !== 1)
      throw new DomainError('conflict_error', 'Action was already consumed.');
    await database
      .update(schema.requestActions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.requestActions.requestId, request.id),
          isNull(schema.requestActions.consumedAt),
        ),
      );
    const localeCopy = copy[identity.locale];
    if (action.action === 'cancel') {
      if ((TERMINAL_STATES as readonly string[]).includes(request.state))
        throw new DomainError('conflict_error', 'Request is already terminal.');
      await database
        .update(schema.requests)
        .set({
          state: 'CANCELLED',
          updatedAt: now,
          version: request.version + 1,
        })
        .where(eq(schema.requests.id, request.id));
      await this.recordRequestEvent(
        database,
        request,
        identity.userId,
        `request:${request.id}`,
        'request.cancelled',
      );
      return this.reply(identity.locale, localeCopy.cancelled, request.id);
    }
    if (request.state !== 'AWAITING_PLAN_CONFIRMATION')
      throw new DomainError(
        'conflict_error',
        'Request is not waiting for plan confirmation.',
      );
    await database
      .update(schema.requestVersions)
      .set({ confirmedAt: now })
      .where(eq(schema.requestVersions.id, currentVersion.id));
    await database
      .update(schema.requests)
      .set({ state: 'QUEUED', updatedAt: now, version: request.version + 1 })
      .where(eq(schema.requests.id, request.id));
    const graphRunId = uuidv7();
    await database.insert(schema.graphRuns).values({
      checkpointSequence: 1,
      currentNode: 'plan_confirmed',
      graphVersion: 'create_blog@1',
      id: graphRunId,
      projectId: request.projectId,
      requestId: request.id,
      requestVersionId: currentVersion.id,
      status: 'queued',
      tenantId: request.tenantId,
    });
    await database.insert(schema.workflowCheckpoints).values({
      graphRunId,
      id: uuidv7(),
      node: 'plan_confirmed',
      projectId: request.projectId,
      sequence: 1,
      state: { requestState: 'QUEUED' },
      tenantId: request.tenantId,
    });
    await database.insert(schema.outboxEvents).values({
      aggregateId: request.id,
      aggregateType: 'request',
      eventType: 'workflow.resume_requested',
      eventVersion: 1,
      id: uuidv7(),
      jobKey: `workflow.resume:${currentVersion.id}:1`,
      payload: {
        requestId: request.id,
        requestVersionId: currentVersion.id,
        tenantId: request.tenantId,
      },
      projectId: request.projectId,
      tenantId: request.tenantId,
    });
    await this.recordRequestEvent(
      database,
      request,
      identity.userId,
      `request:${request.id}`,
      'request.plan_confirmed',
    );
    return this.reply(identity.locale, localeCopy.queued, request.id);
  }

  private async createAction(
    database: ScopedDatabase,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'id' | 'projectId' | 'tenantId'
    >,
    requestVersionId: string,
    userId: string,
    action: 'confirm_plan' | 'cancel',
  ): Promise<string> {
    const token = actionToken();
    await database.insert(schema.requestActions).values({
      action,
      expiresAt: new Date(this.clock.now().getTime() + ACTION_TTL_MS),
      id: uuidv7(),
      projectId: request.projectId,
      requestId: request.id,
      requestVersionId,
      tenantId: request.tenantId,
      tokenHash: digest(token),
      userId,
    });
    return token;
  }

  private async hasCapability(
    database: ScopedDatabase,
    projectId: string,
  ): Promise<boolean> {
    const [row] = await database
      .select({ id: schema.projectCapabilityBindings.id })
      .from(schema.projectCapabilityBindings)
      .innerJoin(
        schema.projectManifestVersions,
        eq(
          schema.projectManifestVersions.id,
          schema.projectCapabilityBindings.manifestVersionId,
        ),
      )
      .where(
        and(
          eq(schema.projectCapabilityBindings.projectId, projectId),
          eq(
            schema.projectCapabilityBindings.capabilityId,
            'create_blog_draft',
          ),
          eq(schema.projectCapabilityBindings.access, 'client_publish'),
          inArray(schema.projectManifestVersions.status, [
            'validated',
            'active',
          ]),
        ),
      )
      .orderBy(desc(schema.projectManifestVersions.version))
      .limit(1);
    return row !== undefined;
  }

  private async latestRequest(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    activeOnly = false,
  ): Promise<typeof schema.requests.$inferSelect | undefined> {
    const conditions = [
      eq(schema.requests.projectId, identity.projectId),
      eq(schema.requests.userId, identity.userId),
    ];
    if (activeOnly)
      conditions.push(
        sql`${schema.requests.state} NOT IN ('COMPLETED', 'FAILED_FINAL', 'CANCELLED', 'SUPERSEDED')`,
      );
    const [row] = await database
      .select()
      .from(schema.requests)
      .where(and(...conditions))
      .orderBy(desc(schema.requests.updatedAt))
      .limit(1);
    return row;
  }

  private async currentRequestVersion(
    database: ScopedDatabase,
    request: typeof schema.requests.$inferSelect,
  ): Promise<typeof schema.requestVersions.$inferSelect> {
    const [row] = await database
      .select()
      .from(schema.requestVersions)
      .where(
        and(
          eq(schema.requestVersions.requestId, request.id),
          eq(schema.requestVersions.version, request.currentVersion),
        ),
      )
      .limit(1);
    if (row === undefined)
      throw new DomainError('internal_error', 'Request version is missing.');
    return row;
  }

  private async recordRequestEvent(
    database: ScopedDatabase,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'id' | 'projectId' | 'tenantId'
    >,
    actorId: string,
    correlationId: string,
    action: string,
  ): Promise<void> {
    await database.insert(schema.auditEvents).values({
      action,
      actorId,
      actorType: actorId.startsWith('admin:')
        ? 'platform_owner'
        : 'telegram_client',
      correlationId,
      id: uuidv7(),
      metadata: {},
      objectId: request.id,
      objectType: 'request',
      projectId: request.projectId,
      tenantId: request.tenantId,
    });
  }

  private reply(
    locale: SupportedLocale,
    text: string,
    requestId: string | null,
    actions: TelegramReply['actionTokens'] = [],
    duplicate = false,
  ): TelegramReply {
    return telegramReplySchema.parse({
      actionTokens: actions,
      duplicate,
      locale,
      requestId,
      text,
    });
  }
}
