import { buildApp } from './app.js';
import { createApiAuthRuntime } from './auth.js';
import { EnrollmentService } from '@binflow/onboarding';
import { IntegrationAdminService } from '@binflow/integration-admin';
import { WorkflowService } from '@binflow/workflows';
import {
  defaultMasterKeyPath,
  loadRuntimeMasterKeyFile,
} from '@binflow/secrets';

const authRuntime = await createApiAuthRuntime();
const app = buildApp({
  auth: authRuntime.auth,
  enrollmentService: new EnrollmentService(authRuntime.database),
  integrationService: new IntegrationAdminService(authRuntime.database, () =>
    loadRuntimeMasterKeyFile(
      process.env.BINFLOW_KEK_FILE ?? defaultMasterKeyPath(),
    ),
  ),
  workflowService: new WorkflowService(authRuntime.database),
});

const close = async (): Promise<void> => {
  await app.close();
  await authRuntime.close();
  process.exitCode = 0;
};

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

await app.listen({
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8080),
});
