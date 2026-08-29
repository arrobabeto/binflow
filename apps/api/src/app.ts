import Fastify, { type FastifyInstance } from 'fastify';

import {
  adminTelegramPairingLinkSchema,
  adminTelegramTargetSchema,
  activationBlockersResponseSchema,
  capabilityCatalogResponseSchema,
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
  readinessResponseSchema,
  requestDetailSchema,
  requestListQuerySchema,
  requestPageSchema,
  requestRevisionInputSchema,
  requestSummarySchema,
  toolAssignmentsResponseSchema,
  toolCatalogResponseSchema,
  toolCustomizationDetailSchema,
  toolCustomizationSummarySchema,
  toolGraphResponseSchema,
  updateEnrollmentInputSchema,
  updateProjectCapabilitiesInputSchema,
  uploadToolCustomizationInputSchema,
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
import type { ToolCatalogService } from '@binflow/tools';
import type { WorkflowService } from '@binflow/workflows';

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
      | 'getCapabilities'
      | 'get'
      | 'getManifest'
      | 'evaluateActivation'
      | 'list'
      | 'update'
      | 'updateCapabilities'
      | 'validate'
    >;
    integrationService?: Pick<
      IntegrationAdminService,
      'create' | 'list' | 'revoke' | 'verify'
    >;
    readinessCheck?: () => Promise<unknown>;
    toolCatalogService?: Pick<
      ToolCatalogService,
      | 'getCurrentCustomization'
      | 'getGraph'
      | 'getTemplate'
      | 'listAssignments'
      | 'listCatalog'
      | 'uploadCustomization'
    >;
    workflowService?: Pick<
      WorkflowService,
      | 'approveAsAdmin'
      | 'cancelAsAdmin'
      | 'createAdminPairingLink'
      | 'get'
      | 'getAdminTelegramTarget'
      | 'list'
      | 'rejectAsAdmin'
      | 'reviseAsAdmin'
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
  const toolCatalogService = options.toolCatalogService;
  const workflowService = options.workflowService;
  const readinessCheck = options.readinessCheck;
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

  app.get('/api/v1/readiness', async (_request, reply) => {
    if (readinessCheck === undefined) {
      void reply.code(503);
      return readinessResponseSchema.parse({
        checks: { runtime: 'misconfigured' },
        status: 'not_ready',
        timestamp: new Date().toISOString(),
      });
    }
    const result = readinessResponseSchema.parse(await readinessCheck());
    if (result.status !== 'ready') void reply.code(503);
    return result;
  });

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
  const requireWorkflowService = (): NonNullable<typeof workflowService> => {
    if (workflowService === undefined) {
      throw new DomainError(
        'internal_error',
        'Workflow runtime is unavailable.',
      );
    }
    return workflowService;
  };
  const requireToolCatalogService = (): NonNullable<
    typeof toolCatalogService
  > => {
    if (toolCatalogService === undefined) {
      throw new DomainError(
        'internal_error',
        'Tool catalog runtime is unavailable.',
      );
    }
    return toolCatalogService;
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

  app.get('/api/v1/requests', async (request) => {
    const session = await requireSession(request);
    const parsed = requestListQuerySchema.parse(request.query);
    const query = {
      limit: parsed.limit,
      ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
      ...(parsed.needsAdminApproval === undefined
        ? {}
        : { needsAdminApproval: parsed.needsAdminApproval }),
      ...(parsed.projectId === undefined ? {} : { projectId: parsed.projectId }),
    };
    return requestPageSchema.parse(
      await requireWorkflowService().list(session.actorId, request.id, query),
    );
  });

  app.get('/api/v1/admin/telegram/target', async (request) => {
    const session = await requireSession(request);
    return adminTelegramTargetSchema.parse(
      await requireWorkflowService().getAdminTelegramTarget(
        session.actorId,
        request.id,
      ),
    );
  });

  app.post('/api/v1/admin/telegram/pairing-link', async (request, reply) => {
    const session = await requireSession(request, true);
    const mutation = requireMutationHeaders(request.headers, false);
    const result = await requireWorkflowService().createAdminPairingLink(
      session.actorId,
      request.id,
      mutation.idempotencyKey,
    );
    void reply.code(201);
    void reply.header('cache-control', 'no-store');
    return adminTelegramPairingLinkSchema.parse(result);
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/requests/:id',
    async (request) => {
      const session = await requireSession(request);
      return requestDetailSchema.parse(
        await requireWorkflowService().get(
          request.params.id,
          session.actorId,
          request.id,
        ),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/requests/:id/cancel',
    async (request, reply) => {
      const session = await requireSession(request, true);
      const mutation = requireMutationHeaders(request.headers);
      const result = await requireWorkflowService().cancelAsAdmin(
        request.params.id,
        mutation.expectedVersion,
        session.actorId,
        request.id,
        mutation.idempotencyKey,
      );
      void reply.header('etag', `"${String(result.revision)}"`);
      return requestSummarySchema.parse(result);
    },
  );

  for (const decision of ['approve', 'reject'] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/v1/requests/:id/${decision}`,
      async (request, reply) => {
        const session = await requireSession(request, true);
        const mutation = requireMutationHeaders(request.headers);
        const service = requireWorkflowService();
        const result = await (decision === 'approve'
          ? service.approveAsAdmin(
              request.params.id,
              mutation.expectedVersion,
              session.actorId,
              request.id,
              mutation.idempotencyKey,
            )
          : service.rejectAsAdmin(
              request.params.id,
              mutation.expectedVersion,
              session.actorId,
              request.id,
              mutation.idempotencyKey,
            ));
        void reply.header('etag', `"${String(result.revision)}"`);
        return requestSummarySchema.parse(result);
      },
    );
  }

  app.post<{ Params: { id: string } }>(
    '/api/v1/requests/:id/revise',
    async (request, reply) => {
      const session = await requireSession(request, true);
      const mutation = requireMutationHeaders(request.headers);
      const body = requestRevisionInputSchema.parse(request.body);
      const result = await requireWorkflowService().reviseAsAdmin(
        request.params.id,
        mutation.expectedVersion,
        body.feedback,
        session.actorId,
        request.id,
        mutation.idempotencyKey,
      );
      void reply.header('etag', `"${String(result.revision)}"`);
      return requestSummarySchema.parse(result);
    },
  );

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

  app.get<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/capabilities',
    async (request) => {
      const session = await requireSession(request);
      const catalog = await requireService().getCapabilities(
        request.params.projectId,
        session.actorId,
        request.id,
      );
      return capabilityCatalogResponseSchema.parse(catalog);
    },
  );

  app.put<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/capabilities',
    async (request) => {
      const session = await requireSession(request, true);
      const mutation = requireMutationHeaders(request.headers, false);
      void mutation;
      return capabilityCatalogResponseSchema.parse(
        await requireService().updateCapabilities(
          request.params.projectId,
          updateProjectCapabilitiesInputSchema.parse(request.body),
          {
            actorId: session.actorId,
            correlationId: request.id,
            idempotencyKey: mutation.idempotencyKey,
          },
        ),
      );
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

  app.get('/api/v1/tools', async (request) => {
    await requireSession(request);
    return toolCatalogResponseSchema.parse(
      await requireToolCatalogService().listCatalog(),
    );
  });

  app.get<{ Params: { toolId: string } }>(
    '/api/v1/tools/:toolId/graph',
    async (request) => {
      await requireSession(request);
      return toolGraphResponseSchema.parse(
        await requireToolCatalogService().getGraph(request.params.toolId),
      );
    },
  );

  app.get<{ Params: { toolId: string } }>(
    '/api/v1/tools/:toolId/customization-template',
    async (request, reply) => {
      await requireSession(request);
      const template = await requireToolCatalogService().getTemplate(
        request.params.toolId,
      );
      void reply.header('content-type', 'text/markdown; charset=utf-8');
      return template;
    },
  );

  app.get<{ Params: { toolId: string } }>(
    '/api/v1/tools/:toolId/assignments',
    async (request) => {
      await requireSession(request);
      return toolAssignmentsResponseSchema.parse(
        await requireToolCatalogService().listAssignments(request.params.toolId),
      );
    },
  );

  app.get<{
    Querystring: { capabilityId?: string; projectId?: string };
  }>('/api/v1/tool-customizations/current', async (request) => {
    const session = await requireSession(request);
    const projectId = request.query.projectId;
    const capabilityId = request.query.capabilityId;
    if (projectId === undefined || capabilityId === undefined)
      throw new DomainError(
        'validation_error',
        'projectId and capabilityId are required.',
      );
    const current = await requireToolCatalogService().getCurrentCustomization(
      projectId,
      capabilityId,
      session.actorId,
      request.id,
    );
    if (current === null) return null;
    return toolCustomizationDetailSchema.parse(current);
  });

  app.post('/api/v1/tool-customizations', async (request) => {
    const session = await requireSession(request, true);
    const mutation = requireMutationHeaders(request.headers, false);
    const body = uploadToolCustomizationInputSchema.parse(request.body);
    const [enrollment] = (
      await requireService().list(session.actorId, request.id)
    ).filter((item) => item.projectId === body.projectId);
    if (enrollment === undefined)
      throw new DomainError(
        'validation_error',
        'Project was not found for customization upload.',
      );
    void mutation;
    return toolCustomizationSummarySchema.parse(
      await requireToolCatalogService().uploadCustomization(body, {
        actorId: session.actorId,
        correlationId: request.id,
        tenantId: enrollment.tenantId,
      }),
    );
  });

  return app;
};
