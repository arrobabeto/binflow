import { input, password } from '@inquirer/prompts';

import type { IntegrationKind } from '@binflow/contracts';

type PromptResult = Readonly<{
  alias: string;
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
  let value: Record<string, string>;

  switch (kind) {
    case 'openai': {
      primarySecret = await secret('OpenAI API key');
      value = { apiKey: primarySecret };
      break;
    }
    case 'telegram-admin':
    case 'telegram-client': {
      primarySecret = await secret('Telegram bot token');
      value = { botToken: primarySecret };
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
      const privateKey = await secret('GitHub App private key (PEM)');
      const webhookSecret = await secret('GitHub App webhook secret');
      primarySecret = privateKey;
      value = { appId, clientId, privateKey, webhookSecret };
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
      value =
        teamId.trim() === ''
          ? { projectId, token }
          : { projectId, teamId, token };
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
    maskedSuffix: primarySecret.slice(-4).padStart(4, '*'),
    plaintext: Buffer.from(JSON.stringify(value), 'utf8'),
  };
};
