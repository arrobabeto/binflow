import * as logfire from '@pydantic/logfire-node';

/**
 * Env-gated Logfire / OpenTelemetry bootstrap (ADR-0056).
 *
 * No-op when LOGFIRE_TOKEN is unset so default local runs and tests stay
 * offline. Never log or return the token value.
 *
 * Must load before instrumented libraries (use Node `--import`).
 */
export const configureBinflowLogfire = (serviceName: string): boolean => {
  const token = process.env.LOGFIRE_TOKEN?.trim();
  if (token === undefined || token.length === 0) {
    return false;
  }

  logfire.configure({
    console: false,
    nodeAutoInstrumentations: {
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
    },
    serviceName:
      process.env.OTEL_SERVICE_NAME?.trim() ||
      process.env.LOGFIRE_SERVICE_NAME?.trim() ||
      serviceName,
  });
  return true;
};

export const isLogfireTokenPresent = (): boolean => {
  const token = process.env.LOGFIRE_TOKEN?.trim();
  return token !== undefined && token.length > 0;
};
