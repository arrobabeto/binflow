import { buildApp } from './app.js';

const app = buildApp();

const close = async (): Promise<void> => {
  await app.close();
  process.exitCode = 0;
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

await app.listen({
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8080),
});
