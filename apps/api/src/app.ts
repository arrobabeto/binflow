import Fastify, { type FastifyInstance } from 'fastify';

import {
  activationBlockersResponseSchema,
  createEnrollmentInputSchema,
  credentialPageSchema,
  credentialSummarySchema,
  credentialVerificationResponseSchema,
  enrollmentPageSchema,
  enrollmentSchema,
  enrollmentValidationResponseSchema,
  healthResponseSchema,
  integrationCandidateInputSchema,
  pairingLinkResponseSchema,
  platformOwnerSessionSchema,
  projectManifestResponseSchema,
  updateEnrollmentInputSchema,
  type HealthResponse,
  type PlatformOwnerSessionResponse,
} from '@binflow/contracts';
import {
  requirePlatformOwnerSession,
  type BinflowAuth,
  type PlatformOwnerSession,
} from '@binflow/auth';
import { DomainError } from '@binflow/domain';
import type { IntegrationAdminService } from '@binflow/integration-admin';
import type { EnrollmentService } from '@binflow/onboarding';

import { normalizeApiError } from './errors.js';

export const buildApp = (
  options: Readonly<{
    auth?: BinflowAuth;
    resolvePlatformOwnerSession?: (
      headers: Headers,
      options?: Readonly<{ fresh?: boolean; twoFactor?: boolean }>,
    ) => Promise<PlatformOwnerSession>;
    enrollmentService?: Pick<
      EnrollmentService,
      | 'create'
      | 'createPairingLink'
      | 'get'
      | 'getManifest'
      | 'evaluateActivation'
      | 'list'
      | 'update'
      | 'validate'
    >;
    integrationService?: Pick<
      IntegrationAdminService,
      'create' | 'list' | 'revoke' | 'verify'
    >;
    trustedOrigin?: string;
  }> = {},
): FastifyInstance => {
  const auth = options.auth;
  const resolvePlatformOwnerSession =
    options.resolvePlatformOwnerSession ??
    (auth === undefined
      ? undefined
      : (headers: Headers, sessionOptions) =>
          requirePlatformOwnerSession(auth, headers, sessionOptions));
  const enrollmentService = options.enrollmentService;
  const integrationService = options.integrationService;
  const trustedOrigin = new URL(
    options.trustedOrigin ??
      process.env.BINFLOW_PUBLIC_URL ??
      'http://localhost:3000',
  ).origin;
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.apiKey',
          'req.body.botToken',
          'req.body.privateKey',
          'req.body.token',
          'req.body.webhookSecret',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-correlation-id', request.id);
    done();
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeApiError(error, request.id);
    if (normalized.statusCode >= 500) {
      request.log.error(
        {
          correlationId: request.id,
          errorCategory: normalized.body.error.category,
        },
        'Request failed',
      );
    }
    return reply.code(normalized.statusCode).send(normalized.body);
  });

  app.get('/api/v1/health', (): HealthResponse =>
    healthResponseSchema.parse({
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.BINFLOW_VERSION ?? 'development',
    }),
  );

  app.get(
    '/api/v1/session',
    async (request): Promise<PlatformOwnerSessionResponse> => {
      if (resolvePlatformOwnerSession === undefined) {
        throw new Error('Authentication runtime is unavailable.');
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const session = await resolvePlatformOwnerSession(headers);
      return platformOwnerSessionSchema.parse({
        actorId: session.actorId,
        email: session.email,
        fresh: session.fresh,
        role: 'platform_owner',
        twoFactor: true,
      });
    },
  );

  type RequestHeaders = Record<string, string | string[] | undefined>;
  const toHeaders = (headers: RequestHeaders): Headers => {
    const converted = new Headers();
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      converted.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    return converted;
  };
  const requireSession = async (
    request: Readonly<{ headers: RequestHeaders }>,
    fresh = false,
  ): Promise<PlatformOwnerSession> => {
    if (resolvePlatformOwnerSession === undefined) {
      throw new DomainError(
        'internal_error',
        'Authentication runtime is unavailable.',
      );
    }
    return resolvePlatformOwnerSession(toHeaders(request.headers), {
      fresh,
      twoFactor: true,
    });
  };
  const requireService = (): NonNullable<typeof enrollmentService> => {
    if (enrollmentService === undefined) {
      throw new DomainError(
        'internal_error',
        'Enrollment runtime is unavailable.',
      );
    }
    return enrollmentService;
  };
  const requireIntegrationService = (): NonNullable<
    typeof integrationService
  > => {
    if (integrationService === undefined) {
      throw new DomainError(
        'internal_error',
        'Integration administration runtime is unavailable.',
      );
    }
    return integrationService;
  };
  const requireMutationHeaders = (
    headers: RequestHeaders,
    requireVersion = true,
  ): Readonly<{ expectedVersion: number; idempotencyKey: string }> => {
    const origin =
      typeof headers.origin === 'string' ? headers.origin : undefined;
    let normalizedOrigin: string | undefined;
    try {
      normalizedOrigin =
        origin === undefined ? undefined : new URL(origin).origin;
    } catch {
      normalizedOrigin = undefined;
    }
    if (normalizedOrigin !== trustedOrigin) {
      throw new DomainError(
        'authorization_error',
        'The request origin is not trusted.',
      );
    }
    const contentType =
      typeof headers['content-type'] === 'string'
        ? headers['content-type']
        : '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      throw new DomainError(
        'validation_error',
        'Content-Type must be application/json.',
      );
    }
    const idempotencyKey =
      typeof headers['idempotency-key'] === 'string'
        ? headers['idempotency-key']
        : '';
    if (
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 200 ||
      !/^[\x20-\x7e]+$/.test(idempotencyKey)
    ) {
      throw new DomainError('validation_error', 'Idempotency-Key is invalid.');
    }
    const ifMatch =
      typeof headers['if-match'] === 'string' ? headers['if-match'] : '';
    const match = /^"([1-9]\d*)"$/.exec(ifMatch);
    if (requireVersion && match === null) {
      throw new DomainError(
        'validation_error',
        'If-Match must contain the current strong ETag.',
      );
    }
    return {
      expectedVersion: match === null ? 0 : Number(match[1]),
      idempotencyKey,
    };
  };

  app.get('/api/v1/admin/enrollments', async (request) => {
    const session = await requireSession(request);
    const items = await requireService().list(session.actorId, request.id);
    return enrollmentPageSchema.parse({ items, nextCursor: null });
  });

  app.get('/api/v1/admin/integrations', async (request) => {
    const session = await requireSession(request);
    const items = await requireIntegrationService().list(
      session.actorId,
      request.id,
    );
    return credentialPageSchema.parse({ items, nextCursor: null });
  });

  app.post('/api/v1/admin/integrations', async (request, reply) => {
    const session = await requireSession(request, true);
    const mutation = requireMutationHeaders(request.headers, false);
    const credential = await requireIntegrationService().create(
      integrationCandidateInputSchema.parse(request.body),
      {
        actorId: session.actorId,
        correlationId: request.id,
        idempotencyKey: mutation.idempotencyKey,
      },
    );
    void reply.header('cache-control', 'no-store');
    void reply.header('etag', `"${String(credential.revision)}"`);
    return credentialSummarySchema.parse(credential);
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/integrations/:id/verify',
    async (request, reply) => {
      const session = await requireSession(request, true);
      const mutation = requireMutationHeaders(request.headers);
      const result = await requireIntegrationService().verify(
        request.params.id,
        mutation.expectedVersion,
        {
          actorId: session.actorId,
          correlationId: request.id,
          idempotencyKey: mutation.idempotencyKey,
        },
      );
      void reply.header('cache-control', 'no-store');
      void reply.header('etag', `"${String(result.credential.revision)}"`);
      return credentialVerificationResponseSchema.parse(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/integrations/:id/revoke',
    async (request, reply) => {
      const session = await requireSession(request, true);
      const mutation = requireMutationHeaders(request.headers);
      const credential = await requireIntegrationService().revoke(
        request.params.id,
        mutation.expectedVersion,
        {
          actorId: session.actorId,
          correlationId: request.id,
          idempotencyKey: mutation.idempotencyKey,
        },
      );
      void reply.header('cache-control', 'no-store');
      void reply.header('etag', `"${String(credential.revision)}"`);
      return credentialSummarySchema.parse(credential);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/enrollments/:id',
    async (request, reply) => {
      const session = await requireSession(request);
      const enrollment = await requireService().get(
        request.params.id,
        session.actorId,
        request.id,
      );
      void reply.header('etag', `"${String(enrollment.version)}"`);
      return enrollmentSchema.parse(enrollment);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/enrollments/:id/manifest',
    async (request) => {
      const session = await requireSession(request);
      const manifest = await requireService().getManifest(
        request.params.id,
        session.actorId,
        request.id,
      );
      return projectManifestResponseSchema.parse(manifest);
    },
  );

  app.post('/api/v1/admin/enrollments', async (request, reply) => {
    const session = await requireSession(request, true);
    const mutation = requireMutationHeaders(request.headers, false);
    const enrollment = await requireService().create(
      createEnrollmentInputSchema.parse(request.body),
      {
        actorId: session.actorId,
        correlationId: request.id,
        idempotencyKey: mutation.idempotencyKey,
      },
    );
    void reply.header('etag', `"${String(enrollment.version)}"`);
    return enrollmentSchema.parse(enrollment);
  });

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/enrollments/:id',
    async (request, reply) => {
      const session = await requireSession(request, true);
      const mutation = requireMutationHeaders(request.headers);
      const enrollment = await requireService().update(
        request.params.id,
        updateEnrollmentInputSchema.parse(request.body),
        mutation.expectedVersion,
        {
          actorId: session.actorId,
          correlationId: request.id,
          idempotencyKey: mutation.idempotencyKey,
        },
      );
      void reply.header('etag', `"${String(enrollment.version)}"`);
      return enrollmentSchema.parse(enrollment);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/enrollments/:id/validate',
    async (request, reply) => {
      const session = await requireSession(request, true);
      const mutation = requireMutationHeaders(request.headers);
      const result = await requireService().validate(
        request.params.id,
        mutation.expectedVersion,
        {
          actorId: session.actorId,
          correlationId: request.id,
          idempotencyKey: mutation.idempotencyKey,
        },
      );
      void reply.header('etag', `"${String(result.enrollment.version)}"`);
      return enrollmentValidationResponseSchema.parse(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/enrollments/:id/pairing-link',
    async (request, reply) => {
      const session = await requireSession(request, true);
      const mutation = requireMutationHeaders(request.headers);
      const result = await requireService().createPairingLink(
        request.params.id,
        mutation.expectedVersion,
        {
          actorId: session.actorId,
          correlationId: request.id,
          idempotencyKey: mutation.idempotencyKey,
        },
      );
      void reply.header('cache-control', 'no-store');
      void reply.header('etag', `"${String(result.enrollment.version)}"`);
      return pairingLinkResponseSchema.parse(result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/enrollments/:id/activate',
    async (request) => {
      const session = await requireSession(request, true);
      const mutation = requireMutationHeaders(request.headers);
      const result = await requireService().evaluateActivation(
        request.params.id,
        mutation.expectedVersion,
        {
          actorId: session.actorId,
          correlationId: request.id,
          idempotencyKey: mutation.idempotencyKey,
        },
      );
      if (result.blockers.length > 0) {
        throw new DomainError(
          'policy_denied',
          `Activation is blocked by: ${result.blockers.join(', ')}.`,
          { code: 'activation_evidence_missing' },
        );
      }
      return activationBlockersResponseSchema.parse(result);
    },
  );

  return app;
};
