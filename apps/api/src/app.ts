import Fastify, { type FastifyInstance } from 'fastify';

import { healthResponseSchema, type HealthResponse } from '@binflow/contracts';

import { normalizeApiError } from './errors.js';

export const buildApp = (): FastifyInstance => {
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

  return app;
};
