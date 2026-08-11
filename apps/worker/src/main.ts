import { readFile } from 'node:fs/promises';

import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const redisUrl =
  process.env.REDIS_URL ??
  (process.env.REDIS_URL_FILE === undefined
    ? 'redis://localhost:6379'
    : (await readFile(process.env.REDIS_URL_FILE, 'utf8')).trim());
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker(
  'binflow-workflows',
  (job) => {
    logger.warn({ jobId: job.id, name: job.name }, 'No workflow is registered');
    return Promise.reject(new Error(`Unsupported workflow job: ${job.name}`));
  },
  { connection },
);

worker.on('ready', () => logger.info('Worker is ready'));
worker.on('error', (error) => logger.error({ error }, 'Worker error'));

const close = async (): Promise<void> => {
  await worker.close();
  await connection.quit();
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
