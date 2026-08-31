import { input, password } from '@inquirer/prompts';
import { cwd } from 'node:process';

import { phase0OpenAIModels } from '@binflow/ai';
import type { IntegrationKind } from '@binflow/contracts';
import { loadSecureSecretFile } from '@binflow/secrets';

export type PromptResult = Readonly<{
  alias: string;
  configuration: Readonly<Record<string, unknown>>;
  maskedSuffix: string;
  plaintext: Buffer;
}>;

const required = (value: string): true | string =>
  value.trim() === '' ? 'A value is required.' : true;

const secret = async (message: string): Promise<string> =>
  password({ mask: '*', message, validate: required });

export const promptIntegrationInput = async (
  kind: IntegrationKind,
): Promise<PromptResult> => {
  let primarySecret: string;
  let configuration: Record<string, unknown>;
  let value: Record<string, string>;

  switch (kind) {
    case 'openai': {
      primarySecret = await secret('OpenAI API key');
      value = { apiKey: primarySecret };
      configuration = { requiredModels: [...phase0OpenAIModels] };
      break;
    }
    case 'telegram-admin':
    case 'telegram-client': {
      primarySecret = await secret('Telegram bot token');
      const expectedUsername = await input({
        message: 'Expected Telegram bot username (without @)',
        validate: required,
      });
      value = { botToken: primarySecret };
      configuration = {
        expectedUsername: expectedUsername.replace(/^@/, ''),
        role: kind === 'telegram-admin' ? 'admin' : 'client',
      };
      break;
    }
    case 'github-app': {
      const appId = await input({
        message: 'GitHub App ID',
        validate: required,
      });
      const clientId = await input({
        message: 'GitHub App client ID',
        validate: required,
      });
      const privateKeyPath = await input({
        message: 'GitHub App private key path (regular 0600 file)',
        validate: required,
      });
      const privateKeyBuffer = await loadSecureSecretFile(
        privateKeyPath,
        cwd(),
      );
      let privateKey: string;
      try {
        privateKey = privateKeyBuffer.toString('utf8');
      } finally {
        privateKeyBuffer.fill(0);
      }
      const webhookSecret = await secret('GitHub App webhook secret');
      primarySecret = webhookSecret;
      value = { privateKey, webhookSecret };
      configuration = { appId, clientId };
      break;
    }
    case 'vercel': {
      const token = await secret('Vercel access token');
      const projectId = await input({
        message: 'Vercel project ID',
        validate: required,
      });
      const teamId = await input({
        message: 'Vercel team ID (leave empty for personal account)',
      });
      primarySecret = token;
      value = { token };
      configuration =
        teamId.trim() === '' ? { projectId } : { projectId, teamId };
      break;
    }
    case 'orbitype-api': {
      const apiKey = await secret('Orbitype API key');
      const baseUrl = await input({
        default: 'https://core.orbitype.com/api/sql/v1',
        message: 'Orbitype SQL API base URL',
        validate: required,
      });
      primarySecret = apiKey;
      value = { apiKey };
      configuration = { baseUrl };
      break;
    }
  }

  const alias = await input({
    default: `${kind} credential`,
    message: 'Credential alias',
    validate: required,
  });
  return {
    alias,
    configuration,
    maskedSuffix: primarySecret.slice(-4).padStart(4, '*'),
    plaintext: Buffer.from(JSON.stringify(value), 'utf8'),
  };
};
