import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

logger.info(
  { version: process.env.BINFLOW_VERSION ?? 'development' },
  'Maintenance process started; no scheduled jobs are enabled in Phase 0',
);
