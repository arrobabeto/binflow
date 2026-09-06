import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { schema, type ScopedDatabase } from '@binflow/db';

const templates = {
  en: (capabilityId: string, requestId: string) =>
    `Piloter completed “${capabilityId}” (request ${requestId}).`,
  es: (capabilityId: string, requestId: string) =>
    `El Piloter completó “${capabilityId}” (solicitud ${requestId}).`,
  de: (capabilityId: string, requestId: string) =>
    `Piloter hat „${capabilityId}“ abgeschlossen (Anfrage ${requestId}).`,
} as const;

/**
 * Template-only owner notice when a Piloter request reaches a successful
 * terminal outcome (ADR-0057). Targets the enrollment (owner chat).
 */
export const enqueuePiloterOwnerSuccessNotice = async (
  database: ScopedDatabase,
  request: Pick<
    typeof schema.requests.$inferSelect,
    | 'capabilityId'
    | 'clientActorRole'
    | 'id'
    | 'projectId'
    | 'tenantId'
    | 'version'
  >,
): Promise<void> => {
  if (request.clientActorRole !== 'piloter') return;
  const [enrollment] = await database
    .select({
      id: schema.clientEnrollments.id,
      locale: schema.clientEnrollments.configuration,
    })
    .from(schema.clientEnrollments)
    .where(
      and(
        eq(schema.clientEnrollments.projectId, request.projectId),
        eq(schema.clientEnrollments.tenantId, request.tenantId),
      ),
    )
    .limit(1);
  if (enrollment === undefined) return;
  const localeRaw =
    enrollment.locale.clientConversationLocale ?? ('en' as const);
  const locale =
    localeRaw === 'es' || localeRaw === 'de' || localeRaw === 'en'
      ? localeRaw
      : 'en';
  const message = templates[locale](request.capabilityId, request.id);
  await database.insert(schema.outboxEvents).values({
    aggregateId: enrollment.id,
    aggregateType: 'enrollment',
    eventType: 'client.notification_requested',
    eventVersion: request.version,
    id: uuidv7(),
    jobKey: `client.notification:piloter.completed:${request.id}:${String(request.version)}`,
    payload: {
      enrollmentId: enrollment.id,
      message,
      notificationType: 'piloter.completed',
      requestId: request.id,
    },
    projectId: request.projectId,
    tenantId: request.tenantId,
  });
};
