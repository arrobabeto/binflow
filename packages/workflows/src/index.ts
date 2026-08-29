import { createHash, randomBytes } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  adminTelegramPairingLinkSchema,
  adminTelegramTargetSchema,
  createBlogDraftInputSchema,
  createProjectAstroInputSchema,
  deleteBlogDraftInputSchema,
  deleteProjectAstroInputSchema,
  capabilityInputSchema,
  projectRequestFailure,
  parseRequestExecution,
  requestDetailSchema,
  requestSummarySchema,
  encodeRequestListCursor,
  decodeRequestListCursor,
  summarizeRequestStageSummary,
  telegramIngressSchema,
  telegramReplySchema,
  type RequestDetail,
  type RequestSummary,
  type RequestListQuery,
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
  withPlatformSystemScope,
  type Database,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';
import { projectCapabilityCatalog, deleteBlogDraftDefinition, deleteProjectAstroDefinition } from '@binflow/policies';
import {
  buildCollectionQuestion,
  heuristicExtractProjectFacts,
  loadProjectContentSchema,
  mergeExtractedProjectFacts,
  scoreOpenProjectContracts,
  type ContentSchemaDocument,
} from '@binflow/tools';

import { graphVersionForCapability } from './capability-graph.js';
import {
  type DeleteBlogCatalogLoader,
  type DeleteProjectCatalogLoader,
} from './delete-blog-catalog.js';
import {
  buildDeleteBlogPlanMessage,
  buildDeleteBlogArticleNotFoundMessage,
  deleteBlogActionLabels,
  buildDeleteBlogUrlConfirmMessage,
  catalogItemsFromRows,
  extractDeleteBlogFacts,
  isDeleteBlogArticleNotFoundError,
  parseDeleteBlogExecuteInput,
  resolveDeleteBlogTargetForPlan,
  scoreDeleteBlogCollection,
} from './delete-blog-ingress.js';
import {
  buildDeleteProjectPlanMessage,
  buildDeleteProjectNotFoundMessage,
  deleteProjectActionLabels,
  buildDeleteProjectUrlConfirmMessage,
  extractDeleteProjectFacts,
  isDeleteProjectNotFoundError,
  parseDeleteProjectExecuteInput,
  resolveDeleteProjectTargetForPlan,
  scoreDeleteProjectCollection,
} from './delete-project-ingress.js';
import {
  capabilityIngressRoutes,
  collectionCapabilityIds,
} from './capability-ingress.js';

export * from './blog-runtime.js';
export * from './delete-blog-catalog.js';
export * from './delete-blog-runtime.js';
export * from './delete-project-runtime.js';
export * from './project-runtime.js';
export { graphVersionForCapability } from './capability-graph.js';
export {
  capabilityIngressRoutes,
  collectionCapabilityIds,
  deleteProjectNaturalLanguage,
  matchesNaturalProject,
} from './capability-ingress.js';
export {
  catalogContentKindsForRuntimeKind,
  catalogScopeForRuntimeKind,
  listRegisteredExecutorIds,
  resolveBundleTitle,
  resolveCapabilityRuntime,
  type CatalogContentScope,
  type CapabilityRuntimeKind,
} from './capability-runtimes.js';

const ACTION_TTL_MS = 24 * 60 * 60 * 1000;
const CLIENT_ACTIVATION_CHECKS = [
  'configuration',
  'openai_credential',
  'telegram_admin_credential',
  'telegram_client_credential',
  'github_app_binding',
  'vercel_binding',
  'project_manifest',
  'capability_catalog',
  'client_pairing',
] as const;
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
    projectGuidance:
      'Erstelle ein zweisprachiges Portfolio-Projekt. Sende Fakten nach und nach (Name, Datum, Beschreibung und client-spezifische Felder). Beispiel: /create_project Headless-Buchungsplattform für Sprachkurse.',
    projectNotEnabled:
      'Das Portfolio-Projekt-Tool ist für diesen Client nicht zugewiesen. Bitte den Operator, es im Dashboard zu aktivieren.',
    projectPlan:
      'Plan bereit für Portfolio-Projekt: Katalog synchronisieren, Ähnlichkeit prüfen, zweisprachige Fallstudie erzeugen, Cover vorbereiten und Preview bauen.',
    projectCollecting:
      'Wir sammeln noch Projektdaten. Antworte mit dem nächsten fehlenden Fakt.',
    help: 'Befehle: /tools, /create_blog <Thema>, /create_project <Brief>, /revise <Feedback>, /status, /cancel und /help.',
    noRequests: 'Es gibt noch keine Anfragen.',
    paired: 'Verbindung hergestellt. Du kannst jetzt /tools verwenden.',
    previewApproved:
      'Vorschau genehmigt. Die Veröffentlichung wurde sicher in die Warteschlange gestellt.',
    adminPending:
      'Vorschau genehmigt. Die neue Kategorie wartet jetzt auf die Admin-Freigabe.',
    revisionPrompt:
      'Revision angefordert. Sende dein Feedback als nächste Nachricht (oder /revise <Text>).',
    revisionQueued:
      'Feedback gespeichert. Der Änderungsplan wird vorbereitet.',
    revisionPlanConfirm: 'Änderung bestätigen',
    revisionPlanAdjust: 'Anfrage anpassen',
    revisionPlanCancel: 'Revision abbrechen',
    revisionCancelled: 'Revision abgebrochen. Die vorherige Vorschau bleibt gültig.',
    revisionAdjustPrompt:
      'Ok. Sende neues Feedback als nächste Nachricht (oder /revise <Text>).',
    revisionApplying: 'Änderung bestätigt. Die Vorschau wird aktualisiert.',
    plan: (topic: string) =>
      `Plan bereit für „${topic}“: Katalog prüfen, auf Ähnlichkeit testen, auf Spanisch erstellen, ins Englische übersetzen, Bild vorbereiten und eine Vorschau bauen.`,
    queued:
      'Plan bestätigt. Die Anfrage wurde sicher in die Warteschlange gestellt.',
    status: (state: string, topic: string) =>
      `Letzte Anfrage: ${topic} — ${state}.`,
    tools:
      'Verfügbare Tools:\n/create_blog — zweisprachigen Blogbeitrag erstellen\n/create_project — Portfolio-Projekt erstellen\n/delete_blog — Blogbeitrag löschen\n/delete_project — Portfolio-Projekt löschen',
    deleteBlogGuidance:
      'Blogbeitrag löschen: sende den Titel oder die öffentliche URL. Beispiel: /delete_blog https://example.com/articulos/mein-artikel',
    deleteBlogNotEnabled:
      'Das Blog-Lösch-Tool ist für diesen Client nicht zugewiesen.',
    deleteProjectGuidance:
      'Portfolio-Projekt löschen: sende den Titel oder die öffentliche URL. Beispiel: /delete_project https://example.com/proyectos/mein-projekt',
    deleteProjectNotEnabled:
      'Das Portfolio-Lösch-Tool ist für diesen Client nicht zugewiesen.',
    deletePreviewPending:
      'Lösch-Preview bereit. Ein Admin muss die Veröffentlichung im Dashboard freigeben.',
    unknown: 'Ich konnte keine verfügbare Aktion erkennen. Verwende /help.',
    messageTooLong:
      'Die Nachricht ist zu lang (max. 10.000 Zeichen). Kürze den Brief und sende ihn erneut.',
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
    projectGuidance:
      'Create a bilingual portfolio project. Send facts over a few messages (name, date, description, plus any client-specific fields). Example: /create_project Headless booking site for language courses.',
    projectNotEnabled:
      'The portfolio project tool is not assigned to this client. Ask the operator to enable it in the dashboard.',
    projectPlan:
      'Plan ready for portfolio project: sync catalog, check similarity, generate bilingual case study, prepare cover and build preview.',
    projectCollecting:
      'Still collecting project facts. Reply with the next missing detail.',
    help: 'Commands: /tools, /create_blog <topic>, /create_project <brief>, /revise <feedback>, /status, /cancel and /help.',
    noRequests: 'There are no requests yet.',
    paired: 'Pairing complete. You can now use /tools.',
    previewApproved: 'Preview approved. Publication was queued safely.',
    adminPending:
      'Preview approved. The new category is now waiting for admin approval.',
    revisionPrompt:
      'Revision requested. Send your feedback as the next message (or /revise <text>).',
    revisionQueued: 'Feedback saved. Preparing the change plan.',
    revisionPlanConfirm: 'Confirm change',
    revisionPlanAdjust: 'Adjust request',
    revisionPlanCancel: 'Cancel revision',
    revisionCancelled:
      'Revision cancelled. The previous preview remains valid.',
    revisionAdjustPrompt:
      'OK. Send new feedback as the next message (or /revise <text>).',
    revisionApplying: 'Change confirmed. Updating the preview.',
    plan: (topic: string) =>
      `Plan ready for “${topic}”: sync the catalog, check similarity, write in Spanish, translate to English, prepare the image and build a preview.`,
    queued: 'Plan confirmed. The request was queued safely.',
    status: (state: string, topic: string) =>
      `Latest request: ${topic} — ${state}.`,
    tools:
      'Available tools:\n/create_blog — create a bilingual blog post\n/create_project — create a portfolio project\n/delete_blog — delete a blog post\n/delete_project — delete a portfolio project',
    deleteBlogGuidance:
      'Delete a blog post by sending its title or public URL. Example: /delete_blog https://example.com/articulos/my-post',
    deleteBlogNotEnabled:
      'The delete blog tool is not assigned to this client.',
    deleteProjectGuidance:
      'Delete a portfolio project by sending its title or public URL. Example: /delete_project https://example.com/proyectos/my-project',
    deleteProjectNotEnabled:
      'The delete project tool is not assigned to this client.',
    deletePreviewPending:
      'Deletion preview is ready. An admin must approve publication in the dashboard.',
    unknown: 'I could not match that to an available action. Use /help.',
    messageTooLong:
      'That message is too long (max 10,000 characters). Shorten the brief and send it again.',
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
    projectGuidance:
      'Crea un proyecto de portafolio bilingüe. Envía los hechos en varios mensajes (nombre, fecha, descripción y campos del cliente). Ejemplo: /create_project Plataforma de reservas para escuela de idiomas online.',
    projectNotEnabled:
      'La tool de proyectos no está asignada a este cliente. Pide al operador que la active en el dashboard.',
    projectPlan:
      'Plan listo para proyecto de portafolio: sincronizar catálogo, revisar similitud, generar case study bilingüe, preparar portada y construir preview.',
    projectCollecting:
      'Seguimos recopilando datos del proyecto. Responde con el siguiente dato que falta.',
    help: 'Comandos: /tools, /create_blog <tema>, /create_project <brief>, /revise <comentarios>, /status, /cancel y /help.',
    noRequests: 'Todavía no hay solicitudes.',
    paired: 'Vinculación completada. Ya puedes usar /tools.',
    previewApproved:
      'Preview aprobado. La publicación quedó encolada de forma segura.',
    adminPending:
      'Preview aprobado. La categoría nueva ahora espera aprobación del admin.',
    revisionPrompt:
      'Revisión solicitada. Envía tu cambio como el siguiente mensaje (o /revise <texto>).',
    revisionQueued: 'Comentarios guardados. Preparando el plan de cambio.',
    revisionPlanConfirm: 'Confirmar cambio',
    revisionPlanAdjust: 'Ajustar pedido',
    revisionPlanCancel: 'Cancelar revisión',
    revisionCancelled:
      'Revisión cancelada. El preview anterior sigue válido.',
    revisionAdjustPrompt:
      'De acuerdo. Envía un nuevo comentario como el siguiente mensaje (o /revise <texto>).',
    revisionApplying: 'Cambio confirmado. Actualizando el preview.',
    plan: (topic: string) =>
      `Plan listo para “${topic}”: sincronizar catálogo, revisar similitud, redactar en español, traducir a inglés, preparar imagen y construir preview.`,
    queued: 'Plan confirmado. La solicitud quedó encolada de forma segura.',
    status: (state: string, topic: string) =>
      `Última solicitud: ${topic} — ${state}.`,
    tools:
      'Tools disponibles:\n/create_blog — crear un blog bilingüe\n/create_project — crear un proyecto de portafolio\n/delete_blog — borrar un artículo del blog\n/delete_project — borrar un proyecto de portafolio',
    deleteBlogGuidance:
      'Para borrar un artículo, envía el título o la URL pública. Ejemplo: /delete_blog https://webbin.com.mx/es/articulos/mi-articulo',
    deleteBlogNotEnabled:
      'La tool de borrado de blog no está asignada a este cliente.',
    deleteProjectGuidance:
      'Para borrar un proyecto, envía el título o la URL pública. Ejemplo: /delete_project https://webbin.com.mx/es/proyectos/mi-proyecto',
    deleteProjectNotEnabled:
      'La tool de borrado de proyectos no está asignada a este cliente.',
    deletePreviewPending:
      'Preview de borrado listo. Un admin debe aprobar la publicación en el dashboard.',
    unknown: 'No pude asociar el mensaje a una acción disponible. Usa /help.',
    messageTooLong:
      'El mensaje es demasiado largo (máx. 10 000 caracteres). Acorta el brief y envíalo de nuevo.',
  },
} as const;

/** Brief-mode topic/context limits from createBlogDraftInputSchema. */
export const BLOG_BRIEF_TOPIC_MAX = 500;
export const BLOG_BRIEF_CONTEXT_MAX = 10_000;

const provisionalBlogTopic = (locale: SupportedLocale): string => {
  switch (locale) {
    case 'de':
      return 'Thema aus deiner Nachricht folgt';
    case 'es':
      return 'Tema por definir desde tu mensaje';
    default:
      return 'Topic pending from your message';
  }
};

/**
 * Maps a free-form Telegram blog message onto brief-mode fields without
 * slicing the client text to fit topic (ADR-0031).
 */
export const mapBlogBriefInput = (
  raw: string,
  locale: SupportedLocale,
):
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'ok'; topic: string; context?: string }>
  | Readonly<{ kind: 'too_long' }> => {
  const text = raw.trim();
  if (text.length === 0) return { kind: 'empty' };
  if (text.length <= BLOG_BRIEF_TOPIC_MAX) return { kind: 'ok', topic: text };
  if (text.length > BLOG_BRIEF_CONTEXT_MAX) return { kind: 'too_long' };
  return {
    kind: 'ok',
    topic: provisionalBlogTopic(locale),
    context: text,
  };
};

/** @deprecated Use {@link mapBlogBriefInput}. */
export const splitBlogBriefText = (
  raw: string,
): ReturnType<typeof mapBlogBriefInput> => mapBlogBriefInput(raw, 'en');

export const PROJECT_BRIEF_MAX = 10_000;

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

const toSummary = (
  row: typeof schema.requests.$inferSelect,
  tenant: Pick<typeof schema.tenants.$inferSelect, 'displayName' | 'key'>,
): RequestSummary =>
  requestSummarySchema.parse({
    capabilityId: row.capabilityId,
    clientKey: tenant.key,
    clientName: tenant.displayName.trim() || tenant.key,
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

const parseInterpretedInput = (
  value: unknown,
): RequestDetail['interpretedInput'] => {
  if (value === null || value === undefined) return null;
  const parsed = capabilityInputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};


const requireTenant = async (
  database: ScopedDatabase,
  tenantId: string,
): Promise<Pick<typeof schema.tenants.$inferSelect, 'displayName' | 'key'>> => {
  const [tenant] = await database
    .select({
      displayName: schema.tenants.displayName,
      key: schema.tenants.key,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  if (tenant === undefined)
    throw new DomainError('internal_error', 'Request tenant is missing.');
  return tenant;
};

export class WorkflowService {
  public constructor(
    private readonly database: Database,
    private readonly clock: Clock = systemClock,
    private readonly deleteBlogCatalogLoader?: DeleteBlogCatalogLoader,
    private readonly deleteProjectCatalogLoader?: DeleteProjectCatalogLoader,
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
            contentDigest: digest(
              `${update.text}:${update.imageArtifactKey ?? ''}`,
            ),
            conversationId: identity.conversationId,
            direction: 'inbound',
            externalUpdateId: update.updateId,
            id: uuidv7(),
            kind: update.text.startsWith('/')
              ? 'command'
              : update.imageArtifactKey !== undefined
                ? 'text'
                : 'text',
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

        return this.route(database, identity, update.text.trim(), {
          ...(update.imageArtifactKey === undefined
            ? {}
            : { imageArtifactKey: update.imageArtifactKey }),
        });
      },
    );
  }

  public async confirmTelegramReplyDelivered(
    raw: TelegramIngress,
  ): Promise<void> {
    const update = telegramIngressSchema.parse(raw);
    await withPlatformSystemScope(
      this.database,
      'telegram.client_pairing_delivery',
      async (database) => {
        const [resolved] = await database
          .select({
            enrollment: schema.clientEnrollments,
            userId: schema.clientUsers.id,
          })
          .from(schema.channelMessages)
          .innerJoin(
            schema.conversations,
            eq(schema.conversations.id, schema.channelMessages.conversationId),
          )
          .innerJoin(
            schema.clientUsers,
            eq(schema.clientUsers.id, schema.conversations.userId),
          )
          .innerJoin(
            schema.clientEnrollments,
            eq(schema.clientEnrollments.id, schema.clientUsers.enrollmentId),
          )
          .where(
            and(
              eq(schema.channelMessages.botId, update.botId),
              eq(schema.channelMessages.externalUpdateId, update.updateId),
              eq(schema.channelMessages.kind, 'pairing'),
            ),
          )
          .limit(1);
        if (resolved === undefined) return;
        if (resolved.enrollment.state === 'active') return;
        if (
          resolved.enrollment.state !== 'pairing_pending' ||
          resolved.enrollment.lastValidatedAt === null
        ) {
          throw new DomainError(
            'conflict_error',
            'Enrollment is not awaiting pairing delivery.',
            { code: 'pairing_delivery_not_pending' },
          );
        }
        const lastValidatedAt = resolved.enrollment.lastValidatedAt;

        const attempts = await database
          .select({
            checkName: schema.enrollmentValidationAttempts.checkName,
            checkedAt: schema.enrollmentValidationAttempts.checkedAt,
            result: schema.enrollmentValidationAttempts.result,
          })
          .from(schema.enrollmentValidationAttempts)
          .where(
            and(
              eq(
                schema.enrollmentValidationAttempts.enrollmentId,
                resolved.enrollment.id,
              ),
              inArray(schema.enrollmentValidationAttempts.checkName, [
                ...CLIENT_ACTIVATION_CHECKS,
              ]),
            ),
          )
          .orderBy(desc(schema.enrollmentValidationAttempts.checkedAt));
        const missing = CLIENT_ACTIVATION_CHECKS.filter(
          (checkName) =>
            attempts.find(
              (attempt) =>
                attempt.checkName === checkName &&
                attempt.checkedAt.getTime() >= lastValidatedAt.getTime(),
            )?.result !== 'success',
        );
        if (missing.length > 0) {
          throw new DomainError(
            'policy_denied',
            'Enrollment activation evidence is incomplete.',
            { code: 'activation_evidence_missing' },
          );
        }

        const now = this.clock.now();
        await database.insert(schema.enrollmentValidationAttempts).values({
          checkName: 'telegram_test_send',
          checkVersion: 1,
          checkedAt: now,
          dependencyFingerprint: digest(
            `${update.botId}:${update.updateId}:delivered`,
          ),
          enrollmentId: resolved.enrollment.id,
          evidence: { botId: update.botId, delivered: true },
          id: uuidv7(),
          projectId: resolved.enrollment.projectId,
          result: 'success',
          tenantId: resolved.enrollment.tenantId,
        });
        const nextVersion = resolved.enrollment.version + 1;
        const activated = await database
          .update(schema.clientEnrollments)
          .set({
            state: 'active',
            updatedAt: now,
            version: nextVersion,
          })
          .where(
            and(
              eq(schema.clientEnrollments.id, resolved.enrollment.id),
              eq(schema.clientEnrollments.version, resolved.enrollment.version),
              eq(schema.clientEnrollments.state, 'pairing_pending'),
            ),
          )
          .returning({ id: schema.clientEnrollments.id });
        if (activated.length !== 1) {
          throw new DomainError(
            'conflict_error',
            'Enrollment changed while recording pairing delivery.',
            { code: 'stale_enrollment' },
          );
        }
        const correlationId = `telegram:${update.botId}:${update.updateId}`;
        await database.insert(schema.auditEvents).values({
          action: 'enrollment.activated',
          actorId: resolved.userId,
          actorType: 'telegram_client',
          correlationId,
          id: uuidv7(),
          metadata: { version: nextVersion },
          objectId: resolved.enrollment.id,
          objectType: 'client_enrollment',
          projectId: resolved.enrollment.projectId,
          tenantId: resolved.enrollment.tenantId,
        });
        await database.insert(schema.outboxEvents).values({
          aggregateId: resolved.enrollment.id,
          aggregateType: 'client_enrollment',
          eventType: 'enrollment.activated',
          eventVersion: 1,
          id: uuidv7(),
          jobKey: `enrollment.activated:${resolved.enrollment.id}:${String(nextVersion)}`,
          payload: { version: nextVersion },
          projectId: resolved.enrollment.projectId,
          tenantId: resolved.enrollment.tenantId,
        });
      },
    );
  }

  public async createAdminPairingLink(
    actorId: string,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<{ expiresAt: string; pairingUrl: string }> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Create admin Telegram pairing link' },
      async (database) => {
        const reserved = await reserveIdempotencyKey(database, {
          actorId,
          expiresAt: new Date(this.clock.now().getTime() + ACTION_TTL_MS),
          idempotencyKey,
          method: 'POST',
          requestHash: hashCanonicalRequest({ action: 'admin_telegram_pair' }),
          route: '/api/v1/admin/telegram/pairing-link',
        });
        if (reserved.kind === 'replay')
          throw new DomainError(
            'conflict_error',
            'Admin Telegram pairing link was already delivered.',
            { code: 'pairing_link_already_delivered' },
          );
        const [credential] = await database
          .select({
            configuration: schema.providerCredentials.configuration,
            id: schema.providerCredentials.id,
          })
          .from(schema.providerCredentials)
          .where(
            and(
              eq(schema.providerCredentials.kind, 'telegram-admin'),
              eq(schema.providerCredentials.status, 'active'),
            ),
          )
          .limit(1);
        const username = (
          credential?.configuration as
            { expectedUsername?: unknown } | undefined
        )?.expectedUsername;
        if (credential === undefined || typeof username !== 'string')
          throw new DomainError(
            'credential_unavailable',
            'An active verified admin Telegram bot is required.',
          );
        const now = this.clock.now();
        await database
          .update(schema.adminPairingTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(schema.adminPairingTokens.botCredentialId, credential.id),
              isNull(schema.adminPairingTokens.consumedAt),
              isNull(schema.adminPairingTokens.revokedAt),
            ),
          );
        const token = actionToken();
        const expiresAt = new Date(now.getTime() + ACTION_TTL_MS);
        await database.insert(schema.adminPairingTokens).values({
          botCredentialId: credential.id,
          createdBy: actorId,
          expiresAt,
          id: uuidv7(),
          tokenHash: digest(token),
        });
        await database.insert(schema.auditEvents).values({
          action: 'admin_telegram.pairing_link_created',
          actorId,
          actorType: 'platform_owner',
          correlationId,
          id: uuidv7(),
          metadata: { expiresAt: expiresAt.toISOString() },
          objectId: credential.id,
          objectType: 'telegram_admin_bot',
        });
        const response = adminTelegramPairingLinkSchema.parse({
          expiresAt: expiresAt.toISOString(),
          pairingUrl: `https://t.me/${username}?start=${token}`,
        });
        await completeIdempotencyRecord(database, {
          id: reserved.id,
          responseBody: { delivered: true },
          responseStatus: 201,
          status: 'completed',
        });
        return response;
      },
    );
  }

  public async getAdminTelegramTarget(actorId: string, correlationId: string) {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Read admin Telegram target' },
      async (database) => {
        const [target] = await database
          .select({
            botId: schema.adminNotificationTargets.botId,
            chatId: schema.adminNotificationTargets.chatId,
            configuration: schema.providerCredentials.configuration,
            externalUserId: schema.adminNotificationTargets.externalUserId,
            pairedAt: schema.adminNotificationTargets.verifiedAt,
            status: schema.adminNotificationTargets.status,
          })
          .from(schema.adminNotificationTargets)
          .innerJoin(
            schema.providerCredentials,
            eq(
              schema.providerCredentials.id,
              schema.adminNotificationTargets.botCredentialId,
            ),
          )
          .where(eq(schema.adminNotificationTargets.status, 'active'))
          .limit(1);
        if (target === undefined) return null;
        return adminTelegramTargetSchema.parse({
          botId: target.botId,
          botUsername: (target.configuration as { expectedUsername?: string })
            .expectedUsername,
          chatId: target.chatId,
          externalUserId: target.externalUserId,
          pairedAt: target.pairedAt.toISOString(),
          status: target.status,
        });
      },
    );
  }

  public async handleAdminTelegramUpdate(
    raw: TelegramIngress,
  ): Promise<TelegramReply> {
    const update = telegramIngressSchema.parse(raw);
    return withPlatformSystemScope(
      this.database,
      'telegram.admin_ingress',
      async (database) => {
        const [bot] = await database
          .select({ id: schema.providerCredentials.id })
          .from(schema.providerCredentials)
          .where(
            and(
              eq(schema.providerCredentials.kind, 'telegram-admin'),
              eq(schema.providerCredentials.status, 'active'),
              eq(schema.providerCredentials.externalResourceId, update.botId),
            ),
          )
          .limit(1);
        if (bot === undefined)
          return this.reply('en', copy.en.accessDenied, null);
        const token = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{32,})$/u.exec(
          update.text.trim(),
        )?.[1];
        if (token !== undefined) {
          const now = this.clock.now();
          const [pairing] = await database
            .select()
            .from(schema.adminPairingTokens)
            .where(
              and(
                eq(schema.adminPairingTokens.botCredentialId, bot.id),
                eq(schema.adminPairingTokens.tokenHash, digest(token)),
                isNull(schema.adminPairingTokens.consumedAt),
                isNull(schema.adminPairingTokens.revokedAt),
                sql`${schema.adminPairingTokens.expiresAt} > ${now}`,
              ),
            )
            .limit(1);
          if (pairing === undefined)
            return this.reply('en', copy.en.accessDenied, null);
          const consumed = await database
            .update(schema.adminPairingTokens)
            .set({ consumedAt: now })
            .where(
              and(
                eq(schema.adminPairingTokens.id, pairing.id),
                isNull(schema.adminPairingTokens.consumedAt),
              ),
            )
            .returning({ id: schema.adminPairingTokens.id });
          if (consumed.length !== 1)
            return this.reply('en', copy.en.accessDenied, null);
          const [existingTarget] = await database
            .select({ id: schema.adminNotificationTargets.id })
            .from(schema.adminNotificationTargets)
            .limit(1);
          const targetId = existingTarget?.id ?? uuidv7();
          if (existingTarget === undefined)
            await database.insert(schema.adminNotificationTargets).values({
              botCredentialId: bot.id,
              botId: update.botId,
              chatId: update.chatId,
              externalUserId: update.externalUserId,
              id: targetId,
              verifiedAt: now,
            });
          else
            await database
              .update(schema.adminNotificationTargets)
              .set({
                botCredentialId: bot.id,
                botId: update.botId,
                chatId: update.chatId,
                externalUserId: update.externalUserId,
                revokedAt: null,
                status: 'active',
                updatedAt: now,
                verifiedAt: now,
              })
              .where(eq(schema.adminNotificationTargets.id, targetId));
          await database.insert(schema.auditEvents).values({
            action: 'admin_telegram.paired',
            actorId: `telegram-admin:${update.externalUserId}`,
            actorType: 'telegram_admin',
            correlationId: `telegram:${update.botId}:${update.updateId}`,
            id: uuidv7(),
            metadata: {
              botId: update.botId,
              externalUserId: update.externalUserId,
              initiatedBy: pairing.createdBy,
              replacedTargetId: existingTarget?.id ?? null,
            },
            objectId: targetId,
            objectType: 'admin_notification_target',
          });
          return this.reply(
            'en',
            'Admin notification channel paired successfully.',
            null,
          );
        }
        const [target] = await database
          .select({ id: schema.adminNotificationTargets.id })
          .from(schema.adminNotificationTargets)
          .where(
            and(
              eq(schema.adminNotificationTargets.botId, update.botId),
              eq(
                schema.adminNotificationTargets.externalUserId,
                update.externalUserId,
              ),
              eq(schema.adminNotificationTargets.chatId, update.chatId),
              eq(schema.adminNotificationTargets.status, 'active'),
            ),
          )
          .limit(1);
        return this.reply(
          'en',
          target === undefined
            ? copy.en.accessDenied
            : 'Binflow admin bot is active. Notifications are enabled.',
          null,
        );
      },
    );
  }

  public async list(
    actorId: string,
    correlationId: string,
    query: RequestListQuery = { limit: 10 },
  ): Promise<{ items: RequestSummary[]; nextCursor: string | null }> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'List workflow requests' },
      async (database) => {
        const filters = [];
        if (query.projectId !== undefined)
          filters.push(eq(schema.requests.projectId, query.projectId));
        if (query.needsAdminApproval === true)
          filters.push(eq(schema.requests.state, 'AWAITING_ADMIN_APPROVAL'));
        if (query.needsAdminApproval === false)
          filters.push(ne(schema.requests.state, 'AWAITING_ADMIN_APPROVAL'));
        if (query.cursor !== undefined) {
          let cursor: ReturnType<typeof decodeRequestListCursor>;
          try {
            cursor = decodeRequestListCursor(query.cursor);
          } catch {
            throw new DomainError(
              'validation_error',
              'Request list cursor is invalid.',
              { code: 'invalid_cursor' },
            );
          }
          filters.push(
            sql`(${schema.requests.updatedAt}, ${schema.requests.id}) < (${cursor.updatedAt}::timestamptz, ${cursor.id})`,
          );
        }
        const rows = await database
          .select({
            displayName: schema.tenants.displayName,
            key: schema.tenants.key,
            request: schema.requests,
          })
          .from(schema.requests)
          .innerJoin(
            schema.tenants,
            eq(schema.tenants.id, schema.requests.tenantId),
          )
          .where(filters.length === 0 ? undefined : and(...filters))
          .orderBy(desc(schema.requests.updatedAt), desc(schema.requests.id))
          .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.map((row) =>
            toSummary(row.request, {
              displayName: row.displayName,
              key: row.key,
            }),
          ),
          nextCursor:
            last === undefined || rows.length <= query.limit
              ? null
              : encodeRequestListCursor({
                  id: last.request.id,
                  updatedAt: last.request.updatedAt.toISOString(),
                }),
        };
      },
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
            displayName: schema.tenants.displayName,
            key: schema.tenants.key,
            request: schema.requests,
            requestVersion: schema.requestVersions,
          })
          .from(schema.requests)
          .innerJoin(
            schema.tenants,
            eq(schema.tenants.id, schema.requests.tenantId),
          )
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
        const [graphRun] =
          row.requestVersion === null
            ? []
            : await database
                .select()
                .from(schema.graphRuns)
                .where(
                  eq(schema.graphRuns.requestVersionId, row.requestVersion.id),
                )
                .limit(1);
        const checkpoints =
          graphRun === undefined
            ? []
            : await database
                .select()
                .from(schema.workflowCheckpoints)
                .where(eq(schema.workflowCheckpoints.graphRunId, graphRun.id))
                .orderBy(asc(schema.workflowCheckpoints.sequence));
        return requestDetailSchema.parse({
          ...toSummary(row.request, {
            displayName: row.displayName,
            key: row.key,
          }),
          confirmedAt: row.requestVersion?.confirmedAt?.toISOString() ?? null,
          execution: parseRequestExecution(row.request.terminalResult),
          failure: projectRequestFailure(
            row.request.terminalResult,
            graphRun?.currentNode,
          ),
          interpretedInput: parseInterpretedInput(
            row.requestVersion?.interpretedInput,
          ),
          plan: row.requestVersion?.plan ?? null,
          stages: checkpoints.map((checkpoint) => ({
            createdAt: checkpoint.createdAt.toISOString(),
            node: checkpoint.node,
            sequence: checkpoint.sequence,
            summary: summarizeRequestStageSummary(
              checkpoint.state as Record<string, unknown>,
            ),
          })),
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
        const locale = await this.clientConversationLocale(database, row);
        if (locale !== undefined)
          await this.enqueueClientNotification(
            database,
            row,
            'request.cancelled',
            copy[locale].cancelled,
            row.version,
          );
        const summary = toSummary(
          row,
          await requireTenant(database, row.tenantId),
        );
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

  public async approveAsAdmin(
    requestId: string,
    expectedVersion: number,
    actorId: string,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<RequestSummary> {
    return this.decideAsAdmin(
      requestId,
      expectedVersion,
      actorId,
      correlationId,
      idempotencyKey,
      'approved',
    );
  }

  public async rejectAsAdmin(
    requestId: string,
    expectedVersion: number,
    actorId: string,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<RequestSummary> {
    return this.decideAsAdmin(
      requestId,
      expectedVersion,
      actorId,
      correlationId,
      idempotencyKey,
      'rejected',
    );
  }

  public async reviseAsAdmin(
    requestId: string,
    expectedVersion: number,
    feedback: string,
    actorId: string,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<RequestSummary> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Queue request revision' },
      async (database) => {
        const reserved = await reserveIdempotencyKey(database, {
          actorId,
          expiresAt: new Date(this.clock.now().getTime() + ACTION_TTL_MS),
          idempotencyKey,
          method: 'POST',
          requestHash: hashCanonicalRequest({ expectedVersion, feedback }),
          route: `/api/v1/requests/${requestId}/revise`,
        });
        if (reserved.kind === 'replay')
          return requestSummarySchema.parse(reserved.responseBody);
        const [request] = await database
          .select()
          .from(schema.requests)
          .where(
            and(
              eq(schema.requests.id, requestId),
              eq(schema.requests.version, expectedVersion),
              eq(schema.requests.state, 'REVISION_REQUESTED'),
            ),
          )
          .limit(1);
        if (request === undefined)
          throw new DomainError(
            'conflict_error',
            'Revision targets a stale or ineligible request.',
          );
        await this.reviseRequest(
          database,
          {
            conversationId: request.conversationId,
            locale: 'en',
            projectId: request.projectId,
            tenantId: request.tenantId,
            userId: request.userId,
          },
          feedback,
          requestId,
          actorId,
        );
        const [updated] = await database
          .select()
          .from(schema.requests)
          .where(eq(schema.requests.id, requestId))
          .limit(1);
        if (updated === undefined)
          throw new DomainError(
            'internal_error',
            'Revised request is missing.',
          );
        const summary = toSummary(
          updated,
          await requireTenant(database, updated.tenantId),
        );
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
    const [replay] = await database
      .select({ configuration: schema.clientEnrollments.configuration })
      .from(schema.channelMessages)
      .innerJoin(
        schema.conversations,
        eq(schema.conversations.id, schema.channelMessages.conversationId),
      )
      .innerJoin(
        schema.clientUsers,
        eq(schema.clientUsers.id, schema.conversations.userId),
      )
      .innerJoin(
        schema.clientEnrollments,
        eq(schema.clientEnrollments.id, schema.clientUsers.enrollmentId),
      )
      .where(
        and(
          eq(schema.channelMessages.botId, update.botId),
          eq(schema.channelMessages.externalUpdateId, update.updateId),
          eq(schema.channelMessages.kind, 'pairing'),
        ),
      )
      .limit(1);
    if (replay !== undefined) {
      const replayLocale =
        replay.configuration.clientConversationLocale ?? ('en' as const);
      return this.reply(replayLocale, copy[replayLocale].paired, null);
    }
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
    extras: Readonly<{ imageArtifactKey?: string }> = {},
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    const imageArtifactKey = extras.imageArtifactKey;
    if (/^\/help(?:@\w+)?$/u.test(text) || /^\/start(?:@\w+)?$/u.test(text))
      return this.reply(identity.locale, localeCopy.help, null);
    if (/^\/tools(?:@\w+)?$/u.test(text)) {
      const enabled = await this.listEnabledCapabilities(
        database,
        identity.projectId,
      );
      if (enabled.length === 0)
        return this.reply(identity.locale, localeCopy.accessDenied, null);
      const lines = enabled.map(
        (item) => `${item.command} — ${item.displayName}`,
      );
      const heading =
        identity.locale === 'es'
          ? 'Tools disponibles:'
          : identity.locale === 'de'
            ? 'Verfügbare Tools:'
            : 'Available tools:';
      return this.reply(identity.locale, `${heading}\n${lines.join('\n')}`, null);
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

    const revision = /^\/revise(?:@\w+)?\s+([\s\S]{1,4000})$/u.exec(text);
    if (revision?.[1] !== undefined)
      return this.reviseRequest(database, identity, revision[1].trim());

    const latestForRevision = await this.latestRequest(database, identity);
    if (
      latestForRevision?.state === 'REVISION_REQUESTED' &&
      !text.startsWith('/') &&
      text.trim().length > 0 &&
      text.trim().length <= 4_000
    )
      return this.reviseRequest(database, identity, text.trim());

    const latestCollecting = await this.latestRequest(database, identity, true);
    if (
      latestCollecting?.state === 'NEEDS_INPUT' &&
      collectionCapabilityIds.has(latestCollecting.capabilityId) &&
      !text.startsWith('/') &&
      (text.trim().length > 0 || imageArtifactKey !== undefined)
    ) {
      if (text.trim().length > PROJECT_BRIEF_MAX)
        return this.reply(identity.locale, localeCopy.messageTooLong, null);
      if (latestCollecting.capabilityId === 'delete_blog_draft')
        return this.continueDeleteBlogCollection(
          database,
          identity,
          latestCollecting,
          text.trim(),
        );
      if (latestCollecting.capabilityId === 'delete_project_astro')
        return this.continueDeleteProjectCollection(
          database,
          identity,
          latestCollecting,
          text.trim(),
        );
      return this.continueProjectCollection(
        database,
        identity,
        latestCollecting,
        text.trim(),
        imageArtifactKey,
      );
    }

    const deleteBlogRoute = capabilityIngressRoutes.find(
      (route) => route.handlerKind === 'delete_blog',
    );
    const deleteProjectRoute = capabilityIngressRoutes.find(
      (route) => route.handlerKind === 'delete_project',
    );
    const blogRoute = capabilityIngressRoutes.find(
      (route) => route.handlerKind === 'blog',
    );
    const projectRoute = capabilityIngressRoutes.find(
      (route) => route.handlerKind === 'project',
    );
    const deleteBlogCommand =
      deleteBlogRoute === undefined
        ? null
        : deleteBlogRoute.commandPattern.exec(text);
    const deleteProjectCommand =
      deleteProjectRoute === undefined
        ? null
        : deleteProjectRoute.commandPattern.exec(text);
    const blogCommand =
      blogRoute === undefined
        ? null
        : blogRoute.commandPattern.exec(text);
    const projectCommand =
      projectRoute === undefined
        ? null
        : projectRoute.commandPattern.exec(text);
    const naturalDeleteBlog =
      deleteBlogRoute?.naturalLanguage?.(text) ?? false;
    const naturalDeleteProject =
      deleteProjectRoute?.naturalLanguage?.(text) ?? false;
    const naturalBlog =
      blogRoute?.naturalLanguage?.(text) ?? false;
    const naturalProject =
      projectRoute?.naturalLanguage?.(text) ?? false;
    const deleteBlogEnabled =
      deleteBlogRoute === undefined
        ? false
        : await this.hasCapability(
            database,
            identity.projectId,
            deleteBlogRoute.capabilityId,
          );
    const deleteProjectEnabled =
      deleteProjectRoute === undefined
        ? false
        : await this.hasCapability(
            database,
            identity.projectId,
            deleteProjectRoute.capabilityId,
          );
    const projectEnabled =
      projectRoute === undefined
        ? false
        : await this.hasCapability(
            database,
            identity.projectId,
            projectRoute.capabilityId,
          );

    if (deleteBlogCommand !== null) {
      const brief = (deleteBlogCommand[1] ?? '').trim();
      if (brief.length === 0)
        return this.reply(identity.locale, localeCopy.deleteBlogGuidance, null);
      if (brief.length > PROJECT_BRIEF_MAX)
        return this.reply(identity.locale, localeCopy.messageTooLong, null);
      return this.createDeleteBlogRequest(database, identity, brief);
    }

    if (deleteProjectCommand !== null) {
      const brief = (deleteProjectCommand[1] ?? '').trim();
      if (brief.length === 0)
        return this.reply(identity.locale, localeCopy.deleteProjectGuidance, null);
      if (brief.length > PROJECT_BRIEF_MAX)
        return this.reply(identity.locale, localeCopy.messageTooLong, null);
      return this.createDeleteProjectRequest(database, identity, brief);
    }

    if (
      deleteBlogEnabled &&
      naturalDeleteBlog &&
      blogCommand === null &&
      deleteBlogCommand === null &&
      deleteProjectCommand === null &&
      !naturalDeleteProject &&
      !naturalProject
    ) {
      const brief = text.trim();
      if (brief.length === 0)
        return this.reply(identity.locale, localeCopy.deleteBlogGuidance, null);
      if (brief.length > PROJECT_BRIEF_MAX)
        return this.reply(identity.locale, localeCopy.messageTooLong, null);
      return this.createDeleteBlogRequest(database, identity, brief);
    }

    if (
      deleteProjectEnabled &&
      naturalDeleteProject &&
      blogCommand === null &&
      deleteBlogCommand === null &&
      deleteProjectCommand === null &&
      !naturalDeleteBlog
    ) {
      const brief = text.trim();
      if (brief.length === 0)
        return this.reply(identity.locale, localeCopy.deleteProjectGuidance, null);
      if (brief.length > PROJECT_BRIEF_MAX)
        return this.reply(identity.locale, localeCopy.messageTooLong, null);
      return this.createDeleteProjectRequest(database, identity, brief);
    }

    if (projectCommand !== null) {
      const brief = (projectCommand[1] ?? '').trim();
      if (brief.length === 0 && imageArtifactKey === undefined)
        return this.reply(identity.locale, localeCopy.projectGuidance, null);
      if (brief.length > PROJECT_BRIEF_MAX)
        return this.reply(identity.locale, localeCopy.messageTooLong, null);
      return this.createProjectRequest(
        database,
        identity,
        brief,
        imageArtifactKey,
      );
    }

    if (
      projectEnabled &&
      naturalProject &&
      blogCommand === null &&
      !naturalBlog
    ) {
      const brief = text.trim();
      if (brief.length === 0 && imageArtifactKey === undefined)
        return this.reply(identity.locale, localeCopy.projectGuidance, null);
      if (brief.length > PROJECT_BRIEF_MAX)
        return this.reply(identity.locale, localeCopy.messageTooLong, null);
      return this.createProjectRequest(
        database,
        identity,
        brief,
        imageArtifactKey,
      );
    }

    if (
      blogCommand !== null ||
      (naturalBlog && !naturalDeleteBlog && !naturalDeleteProject)
    ) {
      const raw = (blogCommand?.[1] ?? (naturalBlog ? text : '')).trim();
      const brief = mapBlogBriefInput(raw, identity.locale);
      if (brief.kind === 'empty')
        return this.reply(identity.locale, localeCopy.guidance, null);
      if (brief.kind === 'too_long')
        return this.reply(identity.locale, localeCopy.messageTooLong, null);
      return this.createRequest(database, identity, brief);
    }
    return this.reply(identity.locale, localeCopy.unknown, null);
  }

  private async createRequest(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    brief: Readonly<{ topic: string; context?: string }>,
  ): Promise<TelegramReply> {
    const { topic, context } = brief;
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
      ...(context === undefined ? {} : { context }),
    });
    const requestId = uuidv7();
    const requestVersionId = uuidv7();
    const plan = {
      nodes: [
        'catalog_sync',
        ...(context === undefined ? [] : (['interpret_brief'] as const)),
        'similarity',
        'category_decision',
        'generate',
        'prepare_image',
        'render_artifacts',
        'create_draft',
        'wait_preview',
        'awaiting_client_approval',
      ],
      topic,
      ...(context === undefined ? {} : { context }),
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
    await this.enqueueAdminNotification(
      database,
      requestIdentity,
      'client_tool_used',
      `Client used create_blog_draft for request ${requestId}.`,
      1,
    );
    const localeCopy = copy[identity.locale];
    return this.reply(identity.locale, localeCopy.plan(topic), requestId, [
      { action: 'confirm_plan', label: localeCopy.confirm, token: confirm },
      { action: 'cancel', label: localeCopy.cancel, token: cancel },
    ]);
  }

  private async createProjectRequest(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    brief: string,
    imageArtifactKey?: string,
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
    const localeCopy = copy[identity.locale];
    if (
      manifest === undefined ||
      !(await this.hasCapability(
        database,
        identity.projectId,
        'create_project_astro',
      ))
    )
      return this.reply(identity.locale, localeCopy.projectNotEnabled, null);

    const contentSchema = await loadProjectContentSchema(this.database, {
      capabilityId: 'create_project_astro',
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    });
    const openIds = scoreOpenProjectContracts({}, contentSchema).open.map(
      (field) => field.id,
    );
    const extracted = heuristicExtractProjectFacts(
      brief,
      openIds,
      contentSchema,
    );
    let closedFacts = mergeExtractedProjectFacts({}, extracted);
    if (imageArtifactKey !== undefined) {
      const imageField =
        contentSchema.fields.find((field) => field.type === 'image')?.id ??
        (openIds.includes('images') ? 'images' : undefined);
      if (imageField === 'images')
        closedFacts = mergeExtractedProjectFacts(closedFacts, {
          images: [imageArtifactKey],
        });
      else if (imageField !== undefined)
        closedFacts = mergeExtractedProjectFacts(closedFacts, {
          [imageField]: imageArtifactKey,
        });
    }
    const score = scoreOpenProjectContracts(closedFacts, contentSchema);
    const topic =
      typeof closedFacts.name === 'string'
        ? String(closedFacts.name).slice(0, 120)
        : brief.trim().length > 0
          ? brief.slice(0, 120)
          : 'portfolio project';
    const requestId = uuidv7();
    const requestVersionId = uuidv7();
    const requestIdentity = {
      id: requestId,
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    };
    const messages = brief.trim().length > 0 ? [brief] : [];

    if (score.closed && score.parsed !== undefined) {
      return this.persistProjectPlanConfirmation(
        database,
        identity,
        manifest.id,
        requestId,
        requestVersionId,
        topic,
        score.parsed,
        messages,
        contentSchema,
      );
    }

    const interpretedInput = createProjectAstroInputSchema.parse({
      closedFacts,
      collectionComplete: false,
      messages,
      mode: 'collect',
      projectId: identity.projectId,
      publicationIntent: 'draft',
    });
    const plan = {
      brief,
      closedFacts,
      contentSchemaFieldIds: contentSchema.fields.map((field) => field.id),
      nodes: ['collect_facts'],
      openFieldIds: score.open.map((field) => field.id),
    };
    await database.insert(schema.requests).values({
      capabilityId: 'create_project_astro',
      conversationId: identity.conversationId,
      currentVersion: 1,
      id: requestId,
      projectId: identity.projectId,
      state: 'NEEDS_INPUT',
      tenantId: identity.tenantId,
      topic,
      userId: identity.userId,
    });
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
    await this.enqueueAdminNotification(
      database,
      requestIdentity,
      'client_tool_used',
      `Client used create_project_astro for request ${requestId}.`,
      1,
    );
    const question = buildCollectionQuestion(score.open, identity.locale);
    return this.reply(identity.locale, question, requestId, [
      { action: 'cancel', label: localeCopy.cancel, token: cancel },
    ]);
  }

  private async continueProjectCollection(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    request: typeof schema.requests.$inferSelect,
    message: string,
    imageArtifactKey?: string,
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    const version = await this.currentRequestVersion(database, request);
    const previous = createProjectAstroInputSchema.parse(version.interpretedInput);
    if (previous.mode !== 'collect')
      return this.reply(identity.locale, localeCopy.unknown, request.id);

    const contentSchema = await loadProjectContentSchema(this.database, {
      capabilityId: 'create_project_astro',
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    });
    const openBefore = scoreOpenProjectContracts(
      previous.closedFacts,
      contentSchema,
      { publicationIntent: previous.publicationIntent },
    ).open.map((field) => field.id);
    const extracted = heuristicExtractProjectFacts(
      message,
      openBefore.length > 0 ? openBefore : ['projectDescription'],
      contentSchema,
    );
    let closedFacts = mergeExtractedProjectFacts(
      previous.closedFacts,
      extracted,
    );
    if (imageArtifactKey !== undefined) {
      const openImageField = contentSchema.fields.find(
        (field) =>
          field.type === 'image' && openBefore.includes(field.id),
      )?.id;
      const anyImageField = contentSchema.fields.find(
        (field) => field.type === 'image',
      )?.id;
      const target = openImageField ?? anyImageField;
      if (target !== undefined)
        closedFacts = mergeExtractedProjectFacts(closedFacts, {
          [target]: imageArtifactKey,
        });
    }
    const messages = (
      message.trim().length > 0
        ? [...previous.messages, message]
        : [...previous.messages]
    ).slice(-40);
    const score = scoreOpenProjectContracts(closedFacts, contentSchema, {
      publicationIntent: previous.publicationIntent,
    });
    const topic =
      typeof closedFacts.name === 'string'
        ? String(closedFacts.name).slice(0, 120)
        : (request.topic ?? message.slice(0, 120));
    const requestIdentity = {
      id: request.id,
      projectId: request.projectId,
      tenantId: request.tenantId,
    };

    if (score.closed && score.parsed !== undefined) {
      const nextVersion = request.currentVersion + 1;
      const requestVersionId = uuidv7();
      await database
        .update(schema.requests)
        .set({ currentVersion: nextVersion, topic })
        .where(eq(schema.requests.id, request.id));
      return this.persistProjectPlanConfirmation(
        database,
        identity,
        version.manifestVersionId,
        request.id,
        requestVersionId,
        topic,
        score.parsed,
        messages,
        contentSchema,
        nextVersion,
      );
    }

    const nextVersion = request.currentVersion + 1;
    const requestVersionId = uuidv7();
    const interpretedInput = createProjectAstroInputSchema.parse({
      closedFacts,
      collectionComplete: false,
      messages,
      mode: 'collect',
      projectId: identity.projectId,
      publicationIntent: previous.publicationIntent,
    });
    await database
      .update(schema.requests)
      .set({ currentVersion: nextVersion, state: 'NEEDS_INPUT', topic })
      .where(eq(schema.requests.id, request.id));
    await database.insert(schema.requestVersions).values({
      capabilityVersion: 1,
      id: requestVersionId,
      interpretedInput,
      manifestVersionId: version.manifestVersionId,
      plan: {
        closedFacts,
        contentSchemaFieldIds: contentSchema.fields.map((field) => field.id),
        nodes: ['collect_facts'],
        openFieldIds: score.open.map((field) => field.id),
      },
      projectId: identity.projectId,
      requestId: request.id,
      tenantId: identity.tenantId,
      version: nextVersion,
    });
    const cancel = await this.createAction(
      database,
      requestIdentity,
      requestVersionId,
      identity.userId,
      'cancel',
    );
    const question = buildCollectionQuestion(score.open, identity.locale);
    return this.reply(identity.locale, question, request.id, [
      { action: 'cancel', label: localeCopy.cancel, token: cancel },
    ]);
  }

  private async loadDeleteBlogCatalogForRequest(
    database: ScopedDatabase,
    manifest: (typeof schema.projectManifestVersions.$inferSelect)['document'],
    projectId: string,
    tenantId: string,
  ): Promise<ReturnType<typeof catalogItemsFromRows>> {
    if (this.deleteBlogCatalogLoader !== undefined)
      return this.deleteBlogCatalogLoader({
        database,
        manifest,
        projectId,
        tenantId,
      });
    return catalogItemsFromRows(
      await this.loadCatalogItemsForProject(database, projectId),
    );
  }

  private async loadCatalogItemsForProject(
    database: ScopedDatabase,
    projectId: string,
  ) {
    return database
      .select({
        category: schema.contentCatalogItems.category,
        contentHash: schema.contentCatalogItems.contentHash,
        locale: schema.contentCatalogItems.locale,
        slug: schema.contentCatalogItems.slug,
        sourceId: schema.contentCatalogItems.sourceId,
        sourceRevision: schema.contentCatalogItems.sourceRevision,
        title: schema.contentCatalogItems.title,
      })
      .from(schema.contentCatalogItems)
      .where(
        and(
          eq(schema.contentCatalogItems.projectId, projectId),
          eq(schema.contentCatalogItems.status, 'published'),
        ),
      );
  }


  private async loadDeleteProjectCatalogForRequest(
    database: ScopedDatabase,
    manifest: (typeof schema.projectManifestVersions.$inferSelect)['document'],
    projectId: string,
    tenantId: string,
  ): Promise<ReturnType<typeof catalogItemsFromRows>> {
    if (this.deleteProjectCatalogLoader !== undefined)
      return this.deleteProjectCatalogLoader({
        database,
        manifest,
        projectId,
        tenantId,
      });
    return catalogItemsFromRows(
      await this.loadCatalogItemsForProject(database, projectId),
    );
  }

  private async createDeleteBlogRequest(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    brief: string,
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    const [manifestRow] = await database
      .select({
        document: schema.projectManifestVersions.document,
        id: schema.projectManifestVersions.id,
      })
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
      manifestRow === undefined ||
      !(await this.hasCapability(
        database,
        identity.projectId,
        'delete_blog_draft',
      ))
    )
      return this.reply(identity.locale, localeCopy.deleteBlogNotEnabled, null);

    const contentSchema = await loadProjectContentSchema(this.database, {
      capabilityId: 'delete_blog_draft',
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    });
    const closedFacts = extractDeleteBlogFacts(brief, contentSchema);
    return this.advanceDeleteBlogCollection(
      database,
      identity,
      manifestRow.id,
      manifestRow.document,
      contentSchema,
      closedFacts,
      brief.trim().length > 0 ? [brief] : [],
      undefined,
    );
  }

  private async continueDeleteBlogCollection(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    request: typeof schema.requests.$inferSelect,
    message: string,
  ): Promise<TelegramReply> {
    const version = await this.currentRequestVersion(database, request);
    const previous = deleteBlogDraftInputSchema.parse(version.interpretedInput);
    if (previous.mode !== 'collect')
      return this.reply(identity.locale, copy[identity.locale].unknown, request.id);
    const [manifestRow] = await database
      .select({
        document: schema.projectManifestVersions.document,
        id: schema.projectManifestVersions.id,
      })
      .from(schema.projectManifestVersions)
      .where(eq(schema.projectManifestVersions.id, version.manifestVersionId))
      .limit(1);
    if (manifestRow === undefined)
      return this.reply(identity.locale, copy[identity.locale].unknown, request.id);
    const contentSchema = await loadProjectContentSchema(this.database, {
      capabilityId: 'delete_blog_draft',
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    });
    const closedFacts = {
      ...previous.closedFacts,
      ...extractDeleteBlogFacts(message, contentSchema),
    };
    const messages =
      message.trim().length > 0
        ? [...previous.messages, message]
        : [...previous.messages];
    return this.advanceDeleteBlogCollection(
      database,
      identity,
      manifestRow.id,
      manifestRow.document,
      contentSchema,
      closedFacts,
      messages,
      request,
    );
  }

  private async failDeleteBlogMissingArticle(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    existingRequest: typeof schema.requests.$inferSelect | undefined,
  ): Promise<TelegramReply> {
    const now = this.clock.now();
    if (existingRequest !== undefined) {
      await database
        .update(schema.requests)
        .set({
          state: 'FAILED_FINAL',
          terminalResult: { failureCode: 'article_not_found' },
          updatedAt: now,
          version: existingRequest.version + 1,
        })
        .where(eq(schema.requests.id, existingRequest.id));
      await this.recordRequestEvent(
        database,
        {
          id: existingRequest.id,
          projectId: existingRequest.projectId,
          tenantId: existingRequest.tenantId,
        },
        identity.userId,
        `request:${existingRequest.id}`,
        'request.failed',
      );
    }
    return this.reply(
      identity.locale,
      buildDeleteBlogArticleNotFoundMessage(identity.locale),
      existingRequest?.id ?? null,
    );
  }

  private async advanceDeleteBlogCollection(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    manifestVersionId: string,
    manifest: (typeof schema.projectManifestVersions.$inferSelect)['document'],
    contentSchema: ContentSchemaDocument,
    closedFacts: Record<string, unknown>,
    messages: readonly string[],
    existingRequest?: typeof schema.requests.$inferSelect,
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    const score = scoreDeleteBlogCollection(closedFacts);
    const requestId = existingRequest?.id ?? uuidv7();
    const requestVersionId = uuidv7();
    const requestIdentity = {
      id: requestId,
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    };
    const catalog = await this.loadDeleteBlogCatalogForRequest(
      database,
      manifest,
      identity.projectId,
      identity.tenantId,
    );

    if (score.needsUrlConfirm) {
      let target;
      try {
        target = resolveDeleteBlogTargetForPlan(
          catalog,
          manifest,
          closedFacts,
        );
      } catch (error) {
        if (isDeleteBlogArticleNotFoundError(error))
          return this.failDeleteBlogMissingArticle(
            database,
            identity,
            existingRequest,
          );
        return this.reply(
          identity.locale,
          localeCopy.unknown,
          existingRequest?.id ?? null,
        );
      }
      const interpretedInput = deleteBlogDraftInputSchema.parse({
        closedFacts: {
          ...closedFacts,
          resolvedSlug: target.resolvedSlug,
          resolvedUrl: target.resolvedUrl,
        },
        collectionComplete: false,
        messages,
        mode: 'collect',
        projectId: identity.projectId,
        resolvedSlug: target.resolvedSlug,
        resolvedUrl: target.resolvedUrl,
      });
      if (existingRequest === undefined) {
        await database.insert(schema.requests).values({
          capabilityId: 'delete_blog_draft',
          conversationId: identity.conversationId,
          currentVersion: 1,
          id: requestId,
          projectId: identity.projectId,
          state: 'NEEDS_INPUT',
          tenantId: identity.tenantId,
          topic: target.resolvedTitle.slice(0, 120),
          userId: identity.userId,
        });
      } else {
        await database
          .update(schema.requests)
          .set({
            currentVersion: existingRequest.currentVersion + 1,
            state: 'NEEDS_INPUT',
            topic: target.resolvedTitle.slice(0, 120),
          })
          .where(eq(schema.requests.id, requestId));
      }
      await database.insert(schema.requestVersions).values({
        capabilityVersion: deleteBlogDraftDefinition.version,
        id: requestVersionId,
        interpretedInput,
        manifestVersionId,
        plan: { closedFacts, needsUrlConfirm: true, nodes: ['resolve_target'] },
        projectId: identity.projectId,
        requestId,
        tenantId: identity.tenantId,
        version: existingRequest?.currentVersion ?? 1,
      });
      const confirm = await this.createAction(
        database,
        requestIdentity,
        requestVersionId,
        identity.userId,
        'confirm_delete_target',
      );
      const cancel = await this.createAction(
        database,
        requestIdentity,
        requestVersionId,
        identity.userId,
        'cancel',
      );
      return this.reply(
        identity.locale,
        buildDeleteBlogUrlConfirmMessage(identity.locale, target),
        requestId,
        [
          {
            action: 'confirm_delete_target',
            label: deleteBlogActionLabels[identity.locale].confirmTarget,
            token: confirm,
          },
          { action: 'cancel', label: localeCopy.cancel, token: cancel },
        ],
      );
    }

    if (score.closed) {
      let target;
      try {
        target = resolveDeleteBlogTargetForPlan(
          catalog,
          manifest,
          closedFacts,
        );
      } catch (error) {
        if (isDeleteBlogArticleNotFoundError(error))
          return this.failDeleteBlogMissingArticle(
            database,
            identity,
            existingRequest,
          );
        return this.reply(
          identity.locale,
          localeCopy.unknown,
          existingRequest?.id ?? null,
        );
      }
      return this.persistDeletePlanConfirmation(
        database,
        identity,
        manifestVersionId,
        requestId,
        requestVersionId,
        target.resolvedTitle.slice(0, 120),
        parseDeleteBlogExecuteInput(identity.projectId, closedFacts, target),
        messages,
        existingRequest?.currentVersion ?? 1,
        existingRequest === undefined,
      );
    }

    const interpretedInput = deleteBlogDraftInputSchema.parse({
      closedFacts,
      collectionComplete: false,
      messages,
      mode: 'collect',
      projectId: identity.projectId,
    });
    if (existingRequest === undefined) {
      await database.insert(schema.requests).values({
        capabilityId: 'delete_blog_draft',
        conversationId: identity.conversationId,
        currentVersion: 1,
        id: requestId,
        projectId: identity.projectId,
        state: 'NEEDS_INPUT',
        tenantId: identity.tenantId,
        topic: 'delete blog',
        userId: identity.userId,
      });
      await this.recordRequestEvent(
        database,
        requestIdentity,
        identity.userId,
        `request:${requestId}`,
        'request.created',
      );
    } else {
      await database
        .update(schema.requests)
        .set({
          currentVersion: existingRequest.currentVersion + 1,
          state: 'NEEDS_INPUT',
        })
        .where(eq(schema.requests.id, requestId));
    }
    await database.insert(schema.requestVersions).values({
      capabilityVersion: deleteBlogDraftDefinition.version,
      id: requestVersionId,
      interpretedInput,
      manifestVersionId,
      plan: {
        closedFacts,
        contentSchemaFieldIds: contentSchema.fields.map((field) => field.id),
        nodes: ['collect_target'],
        openFieldIds: score.openFieldIds,
      },
      projectId: identity.projectId,
      requestId,
      tenantId: identity.tenantId,
      version: existingRequest?.currentVersion ?? 1,
    });
    const cancel = await this.createAction(
      database,
      requestIdentity,
      requestVersionId,
      identity.userId,
      'cancel',
    );
    const ask =
      contentSchema.fields.find((field) => field.id === score.openFieldIds[0])
        ?.ask ??
      localeCopy.deleteBlogGuidance;
    return this.reply(identity.locale, ask, requestId, [
      { action: 'cancel', label: localeCopy.cancel, token: cancel },
    ]);
  }

  private async persistDeletePlanConfirmation(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    manifestVersionId: string,
    requestId: string,
    requestVersionId: string,
    topic: string,
    interpretedInput: ReturnType<typeof parseDeleteBlogExecuteInput>,
    messages: readonly string[],
    version = 1,
    createRequest = true,
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    const [manifestRow] = await database
      .select({ document: schema.projectManifestVersions.document })
      .from(schema.projectManifestVersions)
      .where(eq(schema.projectManifestVersions.id, manifestVersionId))
      .limit(1);
    if (manifestRow === undefined)
      throw new DomainError('internal_error', 'Manifest is missing.');
    const target = resolveDeleteBlogTargetForPlan(
      await this.loadDeleteBlogCatalogForRequest(
        database,
        manifestRow.document,
        identity.projectId,
        identity.tenantId,
      ),
      manifestRow.document,
      {
        ...(interpretedInput.targetTitle === undefined
          ? {}
          : { targetTitle: interpretedInput.targetTitle }),
        ...(interpretedInput.targetUrl === undefined
          ? {}
          : { targetUrl: interpretedInput.targetUrl }),
      },
    );
    const plan = {
      messages,
      nodes: [
        'catalog_sync',
        'resolve_target',
        'validate_deletion',
        'render_deletion_artifacts',
        'open_deletion_pr',
        'awaiting_admin_approval',
      ],
      resolvedSlug: target.resolvedSlug,
    };
    const requestIdentity = {
      id: requestId,
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    };
    if (createRequest) {
      await database.insert(schema.requests).values({
        capabilityId: 'delete_blog_draft',
        conversationId: identity.conversationId,
        currentVersion: 1,
        id: requestId,
        projectId: identity.projectId,
        state: 'AWAITING_PLAN_CONFIRMATION',
        tenantId: identity.tenantId,
        topic,
        userId: identity.userId,
      });
      await this.recordRequestEvent(
        database,
        requestIdentity,
        identity.userId,
        `request:${requestId}`,
        'request.created',
      );
    } else {
      await database
        .update(schema.requests)
        .set({
          currentVersion: version,
          state: 'AWAITING_PLAN_CONFIRMATION',
          topic,
        })
        .where(eq(schema.requests.id, requestId));
    }
    await database.insert(schema.requestVersions).values({
      capabilityVersion: deleteBlogDraftDefinition.version,
      id: requestVersionId,
      interpretedInput,
      manifestVersionId,
      plan,
      projectId: identity.projectId,
      requestId,
      tenantId: identity.tenantId,
      version,
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
    return this.reply(
      identity.locale,
      buildDeleteBlogPlanMessage(
        identity.locale,
        manifestRow.document,
        target,
      ),
      requestId,
      [
        {
          action: 'confirm_plan',
          label: deleteBlogActionLabels[identity.locale].confirmPlan,
          token: confirm,
        },
        { action: 'cancel', label: localeCopy.cancel, token: cancel },
      ],
    );
  }

  private async createDeleteProjectRequest(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    brief: string,
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    const [manifestRow] = await database
      .select({
        document: schema.projectManifestVersions.document,
        id: schema.projectManifestVersions.id,
      })
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
      manifestRow === undefined ||
      !(await this.hasCapability(
        database,
        identity.projectId,
        'delete_project_astro',
      ))
    )
      return this.reply(identity.locale, localeCopy.deleteProjectNotEnabled, null);

    const contentSchema = await loadProjectContentSchema(this.database, {
      capabilityId: 'delete_project_astro',
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    });
    const closedFacts = extractDeleteProjectFacts(brief, contentSchema);
    return this.advanceDeleteProjectCollection(
      database,
      identity,
      manifestRow.id,
      manifestRow.document,
      contentSchema,
      closedFacts,
      brief.trim().length > 0 ? [brief] : [],
      undefined,
    );
  }

  private async continueDeleteProjectCollection(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    request: typeof schema.requests.$inferSelect,
    message: string,
  ): Promise<TelegramReply> {
    const version = await this.currentRequestVersion(database, request);
    const previous = deleteProjectAstroInputSchema.parse(version.interpretedInput);
    if (previous.mode !== 'collect')
      return this.reply(identity.locale, copy[identity.locale].unknown, request.id);
    const [manifestRow] = await database
      .select({
        document: schema.projectManifestVersions.document,
        id: schema.projectManifestVersions.id,
      })
      .from(schema.projectManifestVersions)
      .where(eq(schema.projectManifestVersions.id, version.manifestVersionId))
      .limit(1);
    if (manifestRow === undefined)
      return this.reply(identity.locale, copy[identity.locale].unknown, request.id);
    const contentSchema = await loadProjectContentSchema(this.database, {
      capabilityId: 'delete_project_astro',
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    });
    const closedFacts = {
      ...previous.closedFacts,
      ...extractDeleteProjectFacts(message, contentSchema),
    };
    const messages =
      message.trim().length > 0
        ? [...previous.messages, message]
        : [...previous.messages];
    return this.advanceDeleteProjectCollection(
      database,
      identity,
      manifestRow.id,
      manifestRow.document,
      contentSchema,
      closedFacts,
      messages,
      request,
    );
  }

  private async failDeleteProjectMissingProject(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    existingRequest: typeof schema.requests.$inferSelect | undefined,
  ): Promise<TelegramReply> {
    const now = this.clock.now();
    if (existingRequest !== undefined) {
      await database
        .update(schema.requests)
        .set({
          state: 'FAILED_FINAL',
          terminalResult: { failureCode: 'project_not_found' },
          updatedAt: now,
          version: existingRequest.version + 1,
        })
        .where(eq(schema.requests.id, existingRequest.id));
      await this.recordRequestEvent(
        database,
        {
          id: existingRequest.id,
          projectId: existingRequest.projectId,
          tenantId: existingRequest.tenantId,
        },
        identity.userId,
        `request:${existingRequest.id}`,
        'request.failed',
      );
    }
    return this.reply(
      identity.locale,
      buildDeleteProjectNotFoundMessage(identity.locale),
      existingRequest?.id ?? null,
    );
  }

  private async advanceDeleteProjectCollection(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    manifestVersionId: string,
    manifest: (typeof schema.projectManifestVersions.$inferSelect)['document'],
    contentSchema: ContentSchemaDocument,
    closedFacts: Record<string, unknown>,
    messages: readonly string[],
    existingRequest?: typeof schema.requests.$inferSelect,
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    const score = scoreDeleteProjectCollection(closedFacts);
    const requestId = existingRequest?.id ?? uuidv7();
    const requestVersionId = uuidv7();
    const requestIdentity = {
      id: requestId,
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    };
    const catalog = await this.loadDeleteProjectCatalogForRequest(
      database,
      manifest,
      identity.projectId,
      identity.tenantId,
    );

    if (score.needsUrlConfirm) {
      let target;
      try {
        target = resolveDeleteProjectTargetForPlan(
          catalog,
          manifest,
          closedFacts,
        );
      } catch (error) {
        if (isDeleteProjectNotFoundError(error))
          return this.failDeleteProjectMissingProject(
            database,
            identity,
            existingRequest,
          );
        return this.reply(
          identity.locale,
          localeCopy.unknown,
          existingRequest?.id ?? null,
        );
      }
      const interpretedInput = deleteProjectAstroInputSchema.parse({
        closedFacts: {
          ...closedFacts,
          resolvedSlug: target.resolvedSlug,
          resolvedUrl: target.resolvedUrl,
        },
        collectionComplete: false,
        messages,
        mode: 'collect',
        projectId: identity.projectId,
        resolvedSlug: target.resolvedSlug,
        resolvedUrl: target.resolvedUrl,
      });
      if (existingRequest === undefined) {
        await database.insert(schema.requests).values({
          capabilityId: 'delete_project_astro',
          conversationId: identity.conversationId,
          currentVersion: 1,
          id: requestId,
          projectId: identity.projectId,
          state: 'NEEDS_INPUT',
          tenantId: identity.tenantId,
          topic: target.resolvedTitle.slice(0, 120),
          userId: identity.userId,
        });
      } else {
        await database
          .update(schema.requests)
          .set({
            currentVersion: existingRequest.currentVersion + 1,
            state: 'NEEDS_INPUT',
            topic: target.resolvedTitle.slice(0, 120),
          })
          .where(eq(schema.requests.id, requestId));
      }
      await database.insert(schema.requestVersions).values({
        capabilityVersion: deleteProjectAstroDefinition.version,
        id: requestVersionId,
        interpretedInput,
        manifestVersionId,
        plan: { closedFacts, needsUrlConfirm: true, nodes: ['resolve_target'] },
        projectId: identity.projectId,
        requestId,
        tenantId: identity.tenantId,
        version: existingRequest?.currentVersion ?? 1,
      });
      const confirm = await this.createAction(
        database,
        requestIdentity,
        requestVersionId,
        identity.userId,
        'confirm_delete_target',
      );
      const cancel = await this.createAction(
        database,
        requestIdentity,
        requestVersionId,
        identity.userId,
        'cancel',
      );
      return this.reply(
        identity.locale,
        buildDeleteProjectUrlConfirmMessage(identity.locale, target),
        requestId,
        [
          {
            action: 'confirm_delete_target',
            label: deleteProjectActionLabels[identity.locale].confirmTarget,
            token: confirm,
          },
          { action: 'cancel', label: localeCopy.cancel, token: cancel },
        ],
      );
    }

    if (score.closed) {
      let target;
      try {
        target = resolveDeleteProjectTargetForPlan(
          catalog,
          manifest,
          closedFacts,
        );
      } catch (error) {
        if (isDeleteProjectNotFoundError(error))
          return this.failDeleteProjectMissingProject(
            database,
            identity,
            existingRequest,
          );
        return this.reply(
          identity.locale,
          localeCopy.unknown,
          existingRequest?.id ?? null,
        );
      }
      return this.persistDeleteProjectPlanConfirmation(
        database,
        identity,
        manifestVersionId,
        requestId,
        requestVersionId,
        target.resolvedTitle.slice(0, 120),
        parseDeleteProjectExecuteInput(identity.projectId, closedFacts, target),
        messages,
        existingRequest?.currentVersion ?? 1,
        existingRequest === undefined,
      );
    }

    const interpretedInput = deleteProjectAstroInputSchema.parse({
      closedFacts,
      collectionComplete: false,
      messages,
      mode: 'collect',
      projectId: identity.projectId,
    });
    if (existingRequest === undefined) {
      await database.insert(schema.requests).values({
        capabilityId: 'delete_project_astro',
        conversationId: identity.conversationId,
        currentVersion: 1,
        id: requestId,
        projectId: identity.projectId,
        state: 'NEEDS_INPUT',
        tenantId: identity.tenantId,
        topic: 'delete project',
        userId: identity.userId,
      });
      await this.recordRequestEvent(
        database,
        requestIdentity,
        identity.userId,
        `request:${requestId}`,
        'request.created',
      );
    } else {
      await database
        .update(schema.requests)
        .set({
          currentVersion: existingRequest.currentVersion + 1,
          state: 'NEEDS_INPUT',
        })
        .where(eq(schema.requests.id, requestId));
    }
    await database.insert(schema.requestVersions).values({
      capabilityVersion: deleteProjectAstroDefinition.version,
      id: requestVersionId,
      interpretedInput,
      manifestVersionId,
      plan: {
        closedFacts,
        contentSchemaFieldIds: contentSchema.fields.map((field) => field.id),
        nodes: ['collect_target'],
        openFieldIds: score.openFieldIds,
      },
      projectId: identity.projectId,
      requestId,
      tenantId: identity.tenantId,
      version: existingRequest?.currentVersion ?? 1,
    });
    const cancel = await this.createAction(
      database,
      requestIdentity,
      requestVersionId,
      identity.userId,
      'cancel',
    );
    const ask =
      contentSchema.fields.find((field) => field.id === score.openFieldIds[0])
        ?.ask ??
      localeCopy.deleteProjectGuidance;
    return this.reply(identity.locale, ask, requestId, [
      { action: 'cancel', label: localeCopy.cancel, token: cancel },
    ]);
  }

  private async persistDeleteProjectPlanConfirmation(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    manifestVersionId: string,
    requestId: string,
    requestVersionId: string,
    topic: string,
    interpretedInput: ReturnType<typeof parseDeleteProjectExecuteInput>,
    messages: readonly string[],
    version = 1,
    createRequest = true,
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    const [manifestRow] = await database
      .select({ document: schema.projectManifestVersions.document })
      .from(schema.projectManifestVersions)
      .where(eq(schema.projectManifestVersions.id, manifestVersionId))
      .limit(1);
    if (manifestRow === undefined)
      throw new DomainError('internal_error', 'Manifest is missing.');
    const target = resolveDeleteProjectTargetForPlan(
      await this.loadDeleteProjectCatalogForRequest(
        database,
        manifestRow.document,
        identity.projectId,
        identity.tenantId,
      ),
      manifestRow.document,
      {
        ...(interpretedInput.targetTitle === undefined
          ? {}
          : { targetTitle: interpretedInput.targetTitle }),
        ...(interpretedInput.targetUrl === undefined
          ? {}
          : { targetUrl: interpretedInput.targetUrl }),
      },
    );
    const plan = {
      messages,
      nodes: [
        'catalog_sync',
        'resolve_target',
        'validate_deletion',
        'render_deletion_artifacts',
        'open_deletion_pr',
        'awaiting_admin_approval',
      ],
      resolvedSlug: target.resolvedSlug,
    };
    const requestIdentity = {
      id: requestId,
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    };
    if (createRequest) {
      await database.insert(schema.requests).values({
        capabilityId: 'delete_project_astro',
        conversationId: identity.conversationId,
        currentVersion: 1,
        id: requestId,
        projectId: identity.projectId,
        state: 'AWAITING_PLAN_CONFIRMATION',
        tenantId: identity.tenantId,
        topic,
        userId: identity.userId,
      });
      await this.recordRequestEvent(
        database,
        requestIdentity,
        identity.userId,
        `request:${requestId}`,
        'request.created',
      );
    } else {
      await database
        .update(schema.requests)
        .set({
          currentVersion: version,
          state: 'AWAITING_PLAN_CONFIRMATION',
          topic,
        })
        .where(eq(schema.requests.id, requestId));
    }
    await database.insert(schema.requestVersions).values({
      capabilityVersion: deleteProjectAstroDefinition.version,
      id: requestVersionId,
      interpretedInput,
      manifestVersionId,
      plan,
      projectId: identity.projectId,
      requestId,
      tenantId: identity.tenantId,
      version,
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
    return this.reply(
      identity.locale,
      buildDeleteProjectPlanMessage(
        identity.locale,
        manifestRow.document,
        target,
      ),
      requestId,
      [
        {
          action: 'confirm_plan',
          label: deleteProjectActionLabels[identity.locale].confirmPlan,
          token: confirm,
        },
        { action: 'cancel', label: localeCopy.cancel, token: cancel },
      ],
    );
  }

  private async persistProjectPlanConfirmation(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    manifestVersionId: string,
    requestId: string,
    requestVersionId: string,
    topic: string,
    closedFacts: Readonly<Record<string, unknown>>,
    messages: readonly string[],
    contentSchema: ContentSchemaDocument,
    version = 1,
  ): Promise<TelegramReply> {
    const localeCopy = copy[identity.locale];
    const brief = [
      `name: ${String(closedFacts.name ?? '')}`,
      `fecha: ${String(closedFacts.fecha ?? '')}`,
      `projectDescription: ${String(closedFacts.projectDescription ?? closedFacts.description ?? '')}`,
      ...contentSchema.fields.map(
        (field) => `${field.id}: ${JSON.stringify(closedFacts[field.id] ?? null)}`,
      ),
    ].join('\n');
    const interpretedInput = createProjectAstroInputSchema.parse({
      brief,
      closedFacts,
      mode: 'brief',
      projectId: identity.projectId,
      publicationIntent: 'draft',
      ...(typeof closedFacts.heroScreenshot === 'string'
        ? {
            image: { mode: 'provided' as const },
            imageAssetId: String(closedFacts.heroScreenshot),
          }
        : {}),
      ...(typeof closedFacts.confidencial === 'boolean'
        ? { confidencial: closedFacts.confidencial }
        : {}),
      ...(typeof closedFacts.destacada === 'boolean'
        ? { destacada: closedFacts.destacada }
        : {}),
      ...(typeof closedFacts.fecha === 'string'
        ? { fecha: closedFacts.fecha }
        : {}),
      ...(typeof closedFacts.url === 'string' ? { url: closedFacts.url } : {}),
      ...(Array.isArray(closedFacts.stack)
        ? { stack: closedFacts.stack as string[] }
        : {}),
      ...(typeof closedFacts.tipo === 'string' ? { tipo: closedFacts.tipo } : {}),
      ...(typeof closedFacts.estado === 'string'
        ? { estado: closedFacts.estado }
        : {}),
    });
    const plan = {
      brief,
      closedFacts,
      messages,
      nodes: [
        'catalog_sync',
        'similarity',
        'read_project_url',
        'generate',
        'render_artifacts',
        'create_draft',
        'wait_preview',
        'awaiting_client_approval',
      ],
    };
    const requestIdentity = {
      id: requestId,
      projectId: identity.projectId,
      tenantId: identity.tenantId,
    };
    if (version === 1) {
      await database.insert(schema.requests).values({
        capabilityId: 'create_project_astro',
        conversationId: identity.conversationId,
        currentVersion: 1,
        id: requestId,
        projectId: identity.projectId,
        state: 'AWAITING_PLAN_CONFIRMATION',
        tenantId: identity.tenantId,
        topic,
        userId: identity.userId,
      });
      await this.recordRequestEvent(
        database,
        requestIdentity,
        identity.userId,
        `request:${requestId}`,
        'request.created',
      );
      await this.enqueueAdminNotification(
        database,
        requestIdentity,
        'client_tool_used',
        `Client used create_project_astro for request ${requestId}.`,
        1,
      );
    } else {
      await database
        .update(schema.requests)
        .set({
          currentVersion: version,
          state: 'AWAITING_PLAN_CONFIRMATION',
          topic,
        })
        .where(eq(schema.requests.id, requestId));
    }
    await database.insert(schema.requestVersions).values({
      capabilityVersion: 1,
      id: requestVersionId,
      interpretedInput,
      manifestVersionId,
      plan,
      projectId: identity.projectId,
      requestId,
      tenantId: identity.tenantId,
      version,
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
    return this.reply(
      identity.locale,
      `${localeCopy.projectPlan}\n\n${brief}`,
      requestId,
      [
        { action: 'confirm_plan', label: localeCopy.confirm, token: confirm },
        { action: 'cancel', label: localeCopy.cancel, token: cancel },
      ],
    );
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
    if (action.action === 'confirm_delete_target') {
      if (
        request.state !== 'NEEDS_INPUT' ||
        (request.capabilityId !== 'delete_blog_draft' &&
          request.capabilityId !== 'delete_project_astro')
      )
        throw new DomainError(
          'conflict_error',
          'Request is not waiting for delete target confirmation.',
        );
      if (request.capabilityId === 'delete_blog_draft') {
        const parsed = deleteBlogDraftInputSchema.parse(
          currentVersion.interpretedInput,
        );
        if (parsed.mode !== 'collect')
          throw new DomainError(
            'conflict_error',
            'Delete target input is invalid.',
          );
        const closedFacts = {
          ...parsed.closedFacts,
          targetConfirmed: true,
        };
        const [manifestRow] = await database
          .select({
            document: schema.projectManifestVersions.document,
            id: schema.projectManifestVersions.id,
          })
          .from(schema.projectManifestVersions)
          .where(
            eq(schema.projectManifestVersions.id, currentVersion.manifestVersionId),
          )
          .limit(1);
        if (manifestRow === undefined)
          throw new DomainError('internal_error', 'Manifest is missing.');
        const target = resolveDeleteBlogTargetForPlan(
          await this.loadDeleteBlogCatalogForRequest(
            database,
            manifestRow.document,
            request.projectId,
            request.tenantId,
          ),
          manifestRow.document,
          closedFacts,
        );
        const nextVersion = request.currentVersion + 1;
        const requestVersionId = uuidv7();
        await database
          .update(schema.requests)
          .set({
            currentVersion: nextVersion,
            topic: target.resolvedTitle.slice(0, 120),
          })
          .where(eq(schema.requests.id, request.id));
        return this.persistDeletePlanConfirmation(
          database,
          identity,
          manifestRow.id,
          request.id,
          requestVersionId,
          target.resolvedTitle.slice(0, 120),
          parseDeleteBlogExecuteInput(request.projectId, closedFacts, target),
          parsed.messages,
          nextVersion,
          false,
        );
      }
      const parsed = deleteProjectAstroInputSchema.parse(
        currentVersion.interpretedInput,
      );
      if (parsed.mode !== 'collect')
        throw new DomainError('conflict_error', 'Delete target input is invalid.');
      const closedFacts = {
        ...parsed.closedFacts,
        targetConfirmed: true,
      };
      const [manifestRow] = await database
        .select({
          document: schema.projectManifestVersions.document,
          id: schema.projectManifestVersions.id,
        })
        .from(schema.projectManifestVersions)
        .where(
          eq(schema.projectManifestVersions.id, currentVersion.manifestVersionId),
        )
        .limit(1);
      if (manifestRow === undefined)
        throw new DomainError('internal_error', 'Manifest is missing.');
      const target = resolveDeleteProjectTargetForPlan(
        await this.loadDeleteProjectCatalogForRequest(
          database,
          manifestRow.document,
          request.projectId,
          request.tenantId,
        ),
        manifestRow.document,
        closedFacts,
      );
      const nextVersion = request.currentVersion + 1;
      const requestVersionId = uuidv7();
      await database
        .update(schema.requests)
        .set({ currentVersion: nextVersion, topic: target.resolvedTitle.slice(0, 120) })
        .where(eq(schema.requests.id, request.id));
      return this.persistDeleteProjectPlanConfirmation(
        database,
        identity,
        manifestRow.id,
        request.id,
        requestVersionId,
        target.resolvedTitle.slice(0, 120),
        parseDeleteProjectExecuteInput(request.projectId, closedFacts, target),
        parsed.messages,
        nextVersion,
        false,
      );
    }
    if (action.action === 'request_revision') {
      if (request.state !== 'AWAITING_CLIENT_APPROVAL')
        throw new DomainError(
          'conflict_error',
          'Request is not waiting for preview feedback.',
        );
      await database
        .update(schema.requests)
        .set({
          state: 'REVISION_REQUESTED',
          terminalResult: {
            ...(request.terminalResult as Record<string, unknown>),
            approvalStatus: 'revision_requested',
          },
          updatedAt: now,
          version: request.version + 1,
        })
        .where(eq(schema.requests.id, request.id));
      await this.recordRequestEvent(
        database,
        request,
        identity.userId,
        `request:${request.id}`,
        'request.revision_requested',
      );
      return this.reply(identity.locale, localeCopy.revisionPrompt, request.id);
    }
    if (action.action === 'confirm_revision_plan') {
      if (request.state !== 'AWAITING_REVISION_PLAN_CONFIRMATION')
        throw new DomainError(
          'conflict_error',
          'Request is not waiting for revision plan confirmation.',
        );
      await database
        .update(schema.requests)
        .set({
          state: 'QUEUED',
          updatedAt: now,
          version: request.version + 1,
        })
        .where(eq(schema.requests.id, request.id));
      await database
        .update(schema.graphRuns)
        .set({
          currentNode: 'apply_revision',
          status: 'queued',
          updatedAt: now,
        })
        .where(eq(schema.graphRuns.requestVersionId, currentVersion.id));
      await this.enqueueResume(
        database,
        request,
        currentVersion.id,
        'apply_revision',
        request.version + 1,
      );
      await this.recordRequestEvent(
        database,
        request,
        identity.userId,
        `request:${request.id}`,
        'request.revision_plan_confirmed',
      );
      return this.reply(
        identity.locale,
        localeCopy.revisionApplying,
        request.id,
      );
    }
    if (action.action === 'adjust_revision_plan') {
      if (request.state !== 'AWAITING_REVISION_PLAN_CONFIRMATION')
        throw new DomainError(
          'conflict_error',
          'Request is not waiting for revision plan confirmation.',
        );
      await database
        .update(schema.requests)
        .set({
          state: 'REVISION_REQUESTED',
          updatedAt: now,
          version: request.version + 1,
        })
        .where(eq(schema.requests.id, request.id));
      await this.recordRequestEvent(
        database,
        request,
        identity.userId,
        `request:${request.id}`,
        'request.revision_plan_adjusted',
      );
      return this.reply(
        identity.locale,
        localeCopy.revisionAdjustPrompt,
        request.id,
      );
    }
    if (action.action === 'cancel_revision') {
      if (request.state !== 'AWAITING_REVISION_PLAN_CONFIRMATION')
        throw new DomainError(
          'conflict_error',
          'Request is not waiting for revision plan confirmation.',
        );
      const [prior] = await database
        .select()
        .from(schema.requestVersions)
        .where(
          and(
            eq(schema.requestVersions.requestId, request.id),
            eq(schema.requestVersions.supersededById, currentVersion.id),
          ),
        )
        .limit(1);
      if (prior === undefined)
        throw new DomainError(
          'conflict_error',
          'Prior preview version is missing; cannot cancel revision.',
        );
      await database
        .update(schema.requestVersions)
        .set({ supersededById: null })
        .where(eq(schema.requestVersions.id, prior.id));
      await database
        .update(schema.requests)
        .set({
          currentVersion: prior.version,
          state: 'AWAITING_CLIENT_APPROVAL',
          terminalResult: {
            ...(request.terminalResult as Record<string, unknown>),
            approvalStatus: 'awaiting_client',
            revisionCancelled: true,
          },
          updatedAt: now,
          version: request.version + 1,
        })
        .where(eq(schema.requests.id, request.id));
      await this.recordRequestEvent(
        database,
        request,
        identity.userId,
        `request:${request.id}`,
        'request.revision_cancelled',
      );
      return this.reply(
        identity.locale,
        localeCopy.revisionCancelled,
        request.id,
      );
    }
    if (action.action === 'approve_preview') {
      if (request.state !== 'AWAITING_CLIENT_APPROVAL')
        throw new DomainError(
          'conflict_error',
          'Request is not waiting for client approval.',
        );
      const [evidence] = await database
        .select({
          artifactId: schema.artifacts.id,
          categoryKind: schema.requests.terminalResult,
          deploymentId: schema.deployments.providerId,
          headCommitSha: schema.repoChanges.headSha,
        })
        .from(schema.requests)
        .innerJoin(
          schema.artifacts,
          eq(schema.artifacts.requestVersionId, currentVersion.id),
        )
        .innerJoin(
          schema.repoChanges,
          eq(schema.repoChanges.requestVersionId, currentVersion.id),
        )
        .innerJoin(
          schema.deployments,
          and(
            eq(schema.deployments.requestVersionId, currentVersion.id),
            eq(schema.deployments.environment, 'preview'),
          ),
        )
        .where(eq(schema.requests.id, request.id))
        .limit(1);
      if (evidence === undefined)
        throw new DomainError(
          'conflict_error',
          'Exact preview evidence is unavailable.',
        );
      const categoryKind = (
        evidence.categoryKind as { categoryKind?: unknown } | null
      )?.categoryKind;
      if (request.capabilityId === 'create_blog_draft') {
        if (
          categoryKind !== 'existing' &&
          categoryKind !== 'likely_typo' &&
          categoryKind !== 'new'
        )
          throw new DomainError(
            'internal_error',
            'Category policy evidence is missing.',
          );
      }
      await database.insert(schema.approvals).values({
        approverId: identity.userId,
        artifactId: evidence.artifactId,
        decidedAt: now,
        decision: 'approved',
        deploymentId: evidence.deploymentId,
        expiresAt: new Date(now.getTime() + ACTION_TTL_MS),
        headCommitSha: evidence.headCommitSha,
        id: uuidv7(),
        projectId: request.projectId,
        requestId: request.id,
        requestVersionId: currentVersion.id,
        role: 'client',
        tenantId: request.tenantId,
      });
      const needsAdmin =
        request.capabilityId === 'create_blog_draft' && categoryKind === 'new';
      await database
        .update(schema.requests)
        .set({
          state: needsAdmin
            ? 'AWAITING_ADMIN_APPROVAL'
            : 'APPROVED_FOR_PUBLISH',
          terminalResult: {
            ...(request.terminalResult as Record<string, unknown>),
            approvalStatus: needsAdmin
              ? 'awaiting_admin'
              : 'approved_for_publish',
          },
          updatedAt: now,
          version: request.version + 1,
        })
        .where(eq(schema.requests.id, request.id));
      if (!needsAdmin)
        await this.enqueueResume(
          database,
          request,
          currentVersion.id,
          'publish',
          2,
        );
      if (needsAdmin)
        await this.enqueueAdminNotification(
          database,
          request,
          'admin_approval_required',
          `Admin approval required for new blog category on request ${request.id}.`,
          request.version + 1,
        );
      await this.recordRequestEvent(
        database,
        request,
        identity.userId,
        `request:${request.id}`,
        'request.client_approved',
      );
      return this.reply(
        identity.locale,
        needsAdmin ? localeCopy.adminPending : localeCopy.previewApproved,
        request.id,
      );
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
      graphVersion: await graphVersionForCapability(request.capabilityId),
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
    await this.enqueueResume(
      database,
      request,
      currentVersion.id,
      'execute',
      1,
    );
    await this.recordRequestEvent(
      database,
      request,
      identity.userId,
      `request:${request.id}`,
      'request.plan_confirmed',
    );
    return this.reply(identity.locale, localeCopy.queued, request.id);
  }

  private async reviseRequest(
    database: ScopedDatabase,
    identity: ResolvedIdentity,
    feedback: string,
    exactRequestId?: string,
    actorId = identity.userId,
  ): Promise<TelegramReply> {
    const request =
      exactRequestId === undefined
        ? await this.latestRequest(database, identity)
        : (
            await database
              .select()
              .from(schema.requests)
              .where(
                and(
                  eq(schema.requests.id, exactRequestId),
                  eq(schema.requests.projectId, identity.projectId),
                ),
              )
              .limit(1)
          )[0];
    if (request?.state !== 'REVISION_REQUESTED')
      throw new DomainError(
        'conflict_error',
        'No request is waiting for revision feedback.',
      );
    await database.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`request:${request.id}`}))`,
    );
    const current = await this.currentRequestVersion(database, request);
    if (request.capabilityId !== 'create_blog_draft')
      throw new DomainError(
        'conflict_error',
        'Revisions are not supported for this capability.',
      );
    const parsed = createBlogDraftInputSchema.parse(current.interpretedInput);
    const revisedInput = createBlogDraftInputSchema.parse({
      ...parsed,
      notes: [parsed.notes, `Revision feedback: ${feedback}`]
        .filter((value): value is string => value !== undefined)
        .join('\n\n'),
    });
    const nextVersionId = uuidv7();
    const now = this.clock.now();
    await database.insert(schema.requestVersions).values({
      capabilityVersion: current.capabilityVersion,
      confirmedAt: now,
      id: nextVersionId,
      interpretedInput: revisedInput,
      manifestVersionId: current.manifestVersionId,
      plan: {
        ...(current.plan as Record<string, unknown>),
        revisionFeedback: feedback,
      },
      projectId: request.projectId,
      requestId: request.id,
      tenantId: request.tenantId,
      version: current.version + 1,
    });
    await database
      .update(schema.requestVersions)
      .set({ supersededById: nextVersionId })
      .where(eq(schema.requestVersions.id, current.id));
    await database
      .update(schema.requests)
      .set({
        currentVersion: current.version + 1,
        state: 'QUEUED',
        terminalResult: {
          ...(request.terminalResult as Record<string, unknown>),
          approvalStatus: 'revision_interpreting',
        },
        updatedAt: now,
        version: request.version + 1,
      })
      .where(eq(schema.requests.id, request.id));
    const graphRunId = uuidv7();
    await database.insert(schema.graphRuns).values({
      checkpointSequence: 1,
      currentNode: 'interpret_revision',
      graphVersion: await graphVersionForCapability(request.capabilityId),
      id: graphRunId,
      projectId: request.projectId,
      requestId: request.id,
      requestVersionId: nextVersionId,
      status: 'queued',
      tenantId: request.tenantId,
    });
    await database.insert(schema.workflowCheckpoints).values({
      graphRunId,
      id: uuidv7(),
      node: 'interpret_revision',
      projectId: request.projectId,
      sequence: 1,
      state: { requestState: 'QUEUED' },
      tenantId: request.tenantId,
    });
    await this.enqueueResume(
      database,
      request,
      nextVersionId,
      'interpret_revision',
      current.version + 1,
    );
    await this.recordRequestEvent(
      database,
      request,
      actorId,
      `request:${request.id}`,
      'request.revision_queued',
    );
    return this.reply(
      identity.locale,
      copy[identity.locale].revisionQueued,
      request.id,
    );
  }

  private async decideAsAdmin(
    requestId: string,
    expectedVersion: number,
    actorId: string,
    correlationId: string,
    idempotencyKey: string,
    decision: 'approved' | 'rejected',
  ): Promise<RequestSummary> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Decide category approval' },
      async (database) => {
        const route = `/api/v1/requests/${requestId}/${decision === 'approved' ? 'approve' : 'reject'}`;
        const reserved = await reserveIdempotencyKey(database, {
          actorId,
          expiresAt: new Date(this.clock.now().getTime() + ACTION_TTL_MS),
          idempotencyKey,
          method: 'POST',
          requestHash: hashCanonicalRequest({ decision, expectedVersion }),
          route,
        });
        if (reserved.kind === 'replay')
          return requestSummarySchema.parse(reserved.responseBody);
        await database.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`request:${requestId}`}))`,
        );
        const [context] = await database
          .select({
            artifactId: schema.artifacts.id,
            deploymentId: schema.deployments.providerId,
            headCommitSha: schema.repoChanges.headSha,
            request: schema.requests,
            requestVersionId: schema.requestVersions.id,
          })
          .from(schema.requests)
          .innerJoin(
            schema.requestVersions,
            and(
              eq(schema.requestVersions.requestId, schema.requests.id),
              eq(
                schema.requestVersions.version,
                schema.requests.currentVersion,
              ),
            ),
          )
          .innerJoin(
            schema.artifacts,
            eq(schema.artifacts.requestVersionId, schema.requestVersions.id),
          )
          .innerJoin(
            schema.repoChanges,
            eq(schema.repoChanges.requestVersionId, schema.requestVersions.id),
          )
          .innerJoin(
            schema.deployments,
            and(
              eq(
                schema.deployments.requestVersionId,
                schema.requestVersions.id,
              ),
              eq(schema.deployments.environment, 'preview'),
            ),
          )
          .where(
            and(
              eq(schema.requests.id, requestId),
              eq(schema.requests.version, expectedVersion),
              eq(schema.requests.state, 'AWAITING_ADMIN_APPROVAL'),
            ),
          )
          .limit(1);
        if (context === undefined)
          throw new DomainError(
            'conflict_error',
            'Admin decision targets a stale or ineligible request.',
          );
        const now = this.clock.now();
        if (decision === 'approved')
          await database.insert(schema.approvals).values({
            approverId: actorId,
            artifactId: context.artifactId,
            decidedAt: now,
            decision,
            deploymentId: context.deploymentId,
            expiresAt: new Date(now.getTime() + ACTION_TTL_MS),
            headCommitSha: context.headCommitSha,
            id: uuidv7(),
            projectId: context.request.projectId,
            requestId: context.request.id,
            requestVersionId: context.requestVersionId,
            role: 'admin',
            tenantId: context.request.tenantId,
          });
        const [updated] = await database
          .update(schema.requests)
          .set({
            state:
              decision === 'approved'
                ? 'APPROVED_FOR_PUBLISH'
                : 'REVISION_REQUESTED',
            terminalResult: {
              ...(context.request.terminalResult as Record<string, unknown>),
              approvalStatus:
                decision === 'approved'
                  ? 'approved_for_publish'
                  : 'admin_rejected',
            },
            updatedAt: now,
            version: expectedVersion + 1,
          })
          .where(eq(schema.requests.id, requestId))
          .returning();
        if (updated === undefined)
          throw new DomainError('conflict_error', 'Admin decision was lost.');
        if (decision === 'approved')
          await this.enqueueResume(
            database,
            context.request,
            context.requestVersionId,
            'publish',
            2,
          );
        await this.recordRequestEvent(
          database,
          context.request,
          actorId,
          correlationId,
          decision === 'approved'
            ? 'request.admin_approved'
            : 'request.admin_rejected',
        );
        const summary = toSummary(
          updated,
          await requireTenant(database, updated.tenantId),
        );
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

  private async enqueueResume(
    database: ScopedDatabase,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'id' | 'projectId' | 'tenantId'
    >,
    requestVersionId: string,
    reason:
      | 'execute'
      | 'interpret_revision'
      | 'apply_revision'
      | 'publish'
      | 'reconcile',
    eventVersion: number,
  ): Promise<void> {
    await database.insert(schema.outboxEvents).values({
      aggregateId: request.id,
      aggregateType: 'request',
      eventType: 'workflow.resume_requested',
      eventVersion,
      id: uuidv7(),
      jobKey: `workflow.resume:${requestVersionId}:${reason}:${String(eventVersion)}`,
      payload: {
        reason,
        requestId: request.id,
        requestVersionId,
        tenantId: request.tenantId,
      },
      projectId: request.projectId,
      tenantId: request.tenantId,
    });
  }

  private async enqueueAdminNotification(
    database: ScopedDatabase,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'id' | 'projectId' | 'tenantId'
    >,
    notificationType: string,
    message: string,
    eventVersion: number,
  ): Promise<void> {
    await database.insert(schema.outboxEvents).values({
      aggregateId: request.id,
      aggregateType: 'request',
      eventType: 'admin.notification_requested',
      eventVersion,
      id: uuidv7(),
      jobKey: `admin.notification:${notificationType}:${request.id}:${String(eventVersion)}`,
      payload: { message, notificationType, requestId: request.id },
      projectId: request.projectId,
      tenantId: request.tenantId,
    });
  }

  /**
   * Client notices carry no destination. The worker resolves the paired chat at
   * delivery time so a stored payload can never redirect a client message.
   */
  private async enqueueClientNotification(
    database: ScopedDatabase,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'id' | 'projectId' | 'tenantId'
    >,
    notificationType: string,
    message: string,
    eventVersion: number,
  ): Promise<void> {
    await database.insert(schema.outboxEvents).values({
      aggregateId: request.id,
      aggregateType: 'request',
      eventType: 'client.notification_requested',
      eventVersion,
      id: uuidv7(),
      jobKey: `client.notification:${notificationType}:${request.id}:${String(eventVersion)}`,
      payload: { message, notificationType, requestId: request.id },
      projectId: request.projectId,
      tenantId: request.tenantId,
    });
  }

  /**
   * An unresolvable locale yields no notice. ADR-0011 forbids falling back to a
   * language the client did not choose.
   */
  private async clientConversationLocale(
    database: ScopedDatabase,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'projectId' | 'tenantId' | 'userId'
    >,
  ): Promise<SupportedLocale | undefined> {
    const [row] = await database
      .select({ locale: schema.conversations.locale })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.tenantId, request.tenantId),
          eq(schema.conversations.projectId, request.projectId),
          eq(schema.conversations.userId, request.userId),
        ),
      )
      .orderBy(desc(schema.conversations.lastMessageAt))
      .limit(1);
    if (row === undefined) return undefined;
    return row.locale in copy ? row.locale : undefined;
  }

  private async createAction(
    database: ScopedDatabase,
    request: Pick<
      typeof schema.requests.$inferSelect,
      'id' | 'projectId' | 'tenantId'
    >,
    requestVersionId: string,
    userId: string,
    action:
      | 'confirm_plan'
      | 'confirm_delete_target'
      | 'approve_preview'
      | 'request_revision'
      | 'confirm_revision_plan'
      | 'adjust_revision_plan'
      | 'cancel_revision'
      | 'cancel',
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

  private async listEnabledCapabilities(
    database: ScopedDatabase,
    projectId: string,
  ): Promise<
    readonly Readonly<{ command: string; displayName: string; id: string }>[]
  > {
    const [manifest] = await database
      .select({
        document: schema.projectManifestVersions.document,
        version: schema.projectManifestVersions.version,
      })
      .from(schema.projectManifestVersions)
      .where(
        and(
          eq(schema.projectManifestVersions.projectId, projectId),
          inArray(schema.projectManifestVersions.status, [
            'validated',
            'active',
          ]),
        ),
      )
      .orderBy(desc(schema.projectManifestVersions.version))
      .limit(1);
    if (manifest === undefined) return [];
    return projectCapabilityCatalog(manifest.document.enabledCapabilities)
      .filter((item) => item.enabled)
      .map((item) => ({
        command: item.command,
        displayName: item.displayName,
        id: item.id,
      }));
  }

  private async hasCapability(
    database: ScopedDatabase,
    projectId: string,
    capabilityId = 'create_blog_draft',
  ): Promise<boolean> {
    const enabled = await this.listEnabledCapabilities(database, projectId);
    return enabled.some((item) => item.id === capabilityId);
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
