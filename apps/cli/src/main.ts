import { cwd } from 'node:process';

import { Command, Option } from 'commander';
import { v7 as uuidv7 } from 'uuid';

import {
  integrationKindSchema,
  type IntegrationKind,
} from '@binflow/contracts';
import {
  createDatabase,
  ensureDraftScope,
  listCredentials,
  resolveScope,
  revokeCredential,
  runMigrations,
  storeCredentialVersion,
} from '@binflow/db';
import {
  createMasterKeyFile,
  encryptSecret,
  loadMasterKeyFile,
} from '@binflow/secrets';

import { databaseUrl, masterKeyPath } from './config.js';
import { promptIntegrationInput } from './integration-input.js';

const program = new Command()
  .name('binflow')
  .description('Binflow local bootstrap and integration management')
  .showHelpAfterError();

const withDatabase = async <T>(
  action: (db: ReturnType<typeof createDatabase>['db']) => Promise<T>,
): Promise<T> => {
  const url = await databaseUrl();
  await runMigrations(url);
  const { db, pool } = createDatabase(url);
  try {
    return await action(db);
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
        options.project === undefined
      ) {
        throw new Error(`${kind} requires --project.`);
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
          const envelope = encryptSecret(prompted.plaintext, key, {
            credentialId,
            keyVersion: 1,
            provider: kind,
            tenantId: scope.tenantId ?? 'platform',
          });
          await withDatabase((db) =>
            storeCredentialVersion(db, {
              alias: prompted.alias,
              credentialId,
              envelope,
              kind,
              maskedSuffix: prompted.maskedSuffix,
              scope,
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
  .option('--all', 'Verify all active credentials')
  .action(() => {
    throw new Error(
      'Provider verification adapters are not enabled until the Phase 0 integration spikes are installed.',
    );
  });

await program.parseAsync();
