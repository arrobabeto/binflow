import { cwd } from 'node:process';

import { Command, Option } from 'commander';
import { v7 as uuidv7 } from 'uuid';

import { createOpenAICredentialVerifier } from '@binflow/ai';
import {
  type CredentialOwnerScope,
  integrationKindSchema,
  type IntegrationKind,
  webbinPilotBinding,
} from '@binflow/contracts';
import {
  createDatabase,
  ensureDraftScope,
  listCredentials,
  resolveScope,
  revokeCredential,
  runMigrations,
  storeCredentialVersion,
  type ScopedDatabase,
  withPlatformOwnerScope,
} from '@binflow/db';
import { createGitHubCredentialVerifier } from '@binflow/github';
import {
  createDatabaseCredentialVerificationRepository,
  CredentialVerificationService,
} from '@binflow/integrations';
import { createTelegramCredentialVerifier } from '@binflow/messaging';
import {
  createMasterKeyFile,
  encryptSecret,
  loadMasterKeyFile,
} from '@binflow/secrets';
import { createVercelCredentialVerifier } from '@binflow/vercel';

import { databaseUrl, masterKeyPath, migrationDatabaseUrl } from './config.js';
import { promptIntegrationInput } from './integration-input.js';

const program = new Command()
  .name('binflow')
  .description('Binflow local bootstrap and integration management')
  .showHelpAfterError();

const withDatabase = async <T>(
  action: (db: ScopedDatabase) => Promise<T>,
): Promise<T> => {
  const url = await databaseUrl();
  await runMigrations(await migrationDatabaseUrl());
  const { db, pool } = createDatabase(url);
  try {
    const correlationId = uuidv7();
    return await withPlatformOwnerScope(
      db,
      {
        actorId: 'local-cli',
        correlationId,
        reason: `Phase 0 CLI command: ${process.argv.slice(2, 4).join(' ')}`,
      },
      action,
    );
  } finally {
    await pool.end();
  }
};

program
  .command('secret')
  .description('Manage the external master key')
  .command('init')
  .option('--path <path>', 'External KEK path')
  .action(async ({ path }: { path?: string }) => {
    const destination = path ?? masterKeyPath();
    await createMasterKeyFile(destination, cwd());
    console.log(`Master key initialized at ${destination}`);
  });

program
  .command('scope')
  .description('Manage Phase 0 draft ownership scopes')
  .command('init')
  .requiredOption('--tenant <key>', 'Tenant key')
  .requiredOption('--project <key>', 'Project key')
  .option('--tenant-name <name>', 'Tenant display name')
  .option('--project-name <name>', 'Project display name')
  .action(
    async (options: {
      tenant: string;
      project: string;
      tenantName?: string;
      projectName?: string;
    }) => {
      const scope = await withDatabase((db) =>
        ensureDraftScope(db, {
          projectKey: options.project,
          tenantKey: options.tenant,
          ...(options.projectName === undefined
            ? {}
            : { projectDisplayName: options.projectName }),
          ...(options.tenantName === undefined
            ? {}
            : { tenantDisplayName: options.tenantName }),
        }),
      );
      console.log(
        `Draft scope ready (tenant ${scope.tenantId}, project ${scope.projectId}).`,
      );
    },
  );

const integrations = program
  .command('integration')
  .description('Manage encrypted provider credentials');

integrations
  .command('set')
  .addOption(
    new Option('--kind <kind>', 'Integration kind')
      .choices(integrationKindSchema.options)
      .makeOptionMandatory(),
  )
  .option('--tenant <key>', 'Tenant key')
  .option('--project <key>', 'Project key')
  .action(
    async (options: {
      kind: IntegrationKind;
      tenant?: string;
      project?: string;
    }) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('Secret entry requires an interactive terminal.');
      }
      const kind = integrationKindSchema.parse(options.kind);
      if (
        kind === 'openai' || kind === 'telegram-client'
          ? options.tenant === undefined
          : false
      ) {
        throw new Error(`${kind} requires --tenant.`);
      }
      if (
        (kind === 'github-app' || kind === 'vercel') &&
        (options.tenant === undefined || options.project === undefined)
      ) {
        throw new Error(`${kind} requires --tenant and --project.`);
      }

      const key = await loadMasterKeyFile(masterKeyPath(), cwd());
      try {
        const credentialId = uuidv7();
        const scope = await withDatabase((db) =>
          resolveScope(db, {
            ...(options.project === undefined
              ? {}
              : { projectKey: options.project }),
            ...(options.tenant === undefined
              ? {}
              : { tenantKey: options.tenant }),
          }),
        );
        const prompted = await promptIntegrationInput(kind);
        try {
          let ownerScope: CredentialOwnerScope;
          let credentialScope: typeof scope;
          switch (kind) {
            case 'github-app':
            case 'telegram-admin': {
              ownerScope = 'platform';
              credentialScope = {};
              break;
            }
            case 'openai':
            case 'telegram-client': {
              if (scope.tenantId === undefined) {
                throw new Error(`${kind} requires a tenant scope.`);
              }
              ownerScope = 'tenant';
              credentialScope = { tenantId: scope.tenantId };
              break;
            }
            case 'vercel': {
              if (
                scope.tenantId === undefined ||
                scope.projectId === undefined
              ) {
                throw new Error('vercel requires a project scope.');
              }
              ownerScope = 'project';
              credentialScope = scope;
              break;
            }
          }
          const envelope = encryptSecret(prompted.plaintext, key, {
            credentialId,
            keyVersion: 1,
            provider: kind,
            tenantId: credentialScope.tenantId ?? 'platform',
          });
          await withDatabase((db) =>
            storeCredentialVersion(db, {
              alias: prompted.alias,
              configuration: kind === 'vercel' ? {} : prompted.configuration,
              ...((kind === 'github-app' || kind === 'vercel') &&
              scope.tenantId !== undefined &&
              scope.projectId !== undefined
                ? {
                    connection: {
                      configuration: {
                        ...(kind === 'vercel' ? prompted.configuration : {}),
                        ...(kind === 'github-app'
                          ? {
                              defaultBranch:
                                webbinPilotBinding.productionBranch,
                            }
                          : {
                              expectedProductionBranch:
                                webbinPilotBinding.productionBranch,
                            }),
                        expectedRepository: webbinPilotBinding.repository,
                      },
                      kind,
                      scope: {
                        projectId: scope.projectId,
                        tenantId: scope.tenantId,
                      },
                    },
                  }
                : {}),
              credentialId,
              envelope,
              kind,
              maskedSuffix: prompted.maskedSuffix,
              ownerScope,
              scope: credentialScope,
            }),
          );
        } finally {
          prompted.plaintext.fill(0);
        }
        console.log(
          `Credential stored as ${credentialId}; value will not be shown.`,
        );
      } finally {
        key.fill(0);
      }
    },
  );

integrations.command('list').action(async () => {
  const credentials = await withDatabase(listCredentials);
  console.table(credentials);
});

integrations
  .command('revoke')
  .argument('<id>', 'Credential ID')
  .action(async (id: string) => {
    const found = await withDatabase((db) => revokeCredential(db, id));
    if (!found) {
      process.exitCode = 1;
      console.error(`Credential not found: ${id}`);
      return;
    }
    console.log(`Credential revoked: ${id}`);
  });

integrations
  .command('verify')
  .argument('[id]', 'Credential ID')
  .option('--all', 'Verify active credentials and newest candidates')
  .action(async (id: string | undefined, options: { all?: boolean }) => {
    if ((id === undefined) === (options.all !== true)) {
      throw new Error('Provide one credential ID or --all.');
    }
    const key = await loadMasterKeyFile(masterKeyPath(), cwd());
    try {
      const results = await withDatabase(async (db) => {
        const service = new CredentialVerificationService(
          createDatabaseCredentialVerificationRepository(db),
          [
            createOpenAICredentialVerifier(),
            createTelegramCredentialVerifier(),
            createGitHubCredentialVerifier(),
            createVercelCredentialVerifier(),
          ],
        );
        if (options.all === true) return service.verifyAll(key);
        if (id === undefined) {
          throw new Error('Credential ID is required without --all.');
        }
        return [await service.verify(id, key)];
      });
      console.table(
        results.map((result) => ({
          checkedAt: result.checkedAt,
          credentialId: result.credentialId,
          details:
            result.evidence === undefined
              ? result.errorCategory
              : JSON.stringify(result.evidence),
          kind: result.kind,
          outcome: result.outcome,
        })),
      );
      if (results.some((result) => result.outcome === 'failed')) {
        process.exitCode = 1;
      }
    } finally {
      key.fill(0);
    }
  });

await program.parseAsync();
