import Fastify, { type FastifyInstance } from 'fastify';

import { healthResponseSchema, type HealthResponse } from '@binflow/contracts';

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
