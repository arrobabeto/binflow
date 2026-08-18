import Fastify, { type FastifyInstance } from 'fastify';

import {
  healthResponseSchema,
  platformOwnerSessionSchema,
  type HealthResponse,
  type PlatformOwnerSessionResponse,
} from '@binflow/contracts';
import {
  requirePlatformOwnerSession,
  type BinflowAuth,
  type PlatformOwnerSession,
} from '@binflow/auth';

import { normalizeApiError } from './errors.js';

export const buildApp = (
  options: Readonly<{
    auth?: BinflowAuth;
    resolvePlatformOwnerSession?: (
      headers: Headers,
    ) => Promise<PlatformOwnerSession>;
  }> = {},
): FastifyInstance => {
  const auth = options.auth;
  const resolvePlatformOwnerSession =
    options.resolvePlatformOwnerSession ??
    (auth === undefined
      ? undefined
      : (headers: Headers) => requirePlatformOwnerSession(auth, headers));
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
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

  return app;
};
