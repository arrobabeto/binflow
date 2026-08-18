import { DomainError } from '@binflow/domain';
import type {
  CredentialVerifier,
  CredentialVerifierInput,
  VerificationEvidence,
} from '@binflow/integrations';
import { decryptSecret } from '@binflow/secrets';
import { z } from 'zod';

export const phase0OpenAIModels = [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-image-2',
  'text-embedding-3-small',
] as const;

const secretSchema = z.object({ apiKey: z.string().min(1) }).strict();
const configurationSchema = z
  .object({
    requiredModels: z.array(z.string().min(1)).min(1),
  })
  .strict();
const modelCatalogSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })),
});

const mapHttpError = (status: number): DomainError => {
  if (status === 401) {
    return new DomainError(
      'authentication_error',
      'OpenAI rejected the credential.',
    );
  }
  if (status === 403) {
    return new DomainError(
      'authorization_error',
      'OpenAI denied access to the model catalog.',
    );
  }
  if (status === 429 || status >= 500) {
    return new DomainError(
      'provider_retryable',
      'OpenAI is temporarily unavailable.',
    );
  }
  return new DomainError(
    'provider_final',
    'OpenAI returned an unexpected response.',
  );
};

export const createOpenAICredentialVerifier = (
  options: Readonly<{
    apiBaseUrl?: string;
    fetch?: typeof globalThis.fetch;
  }> = {},
): CredentialVerifier => ({
  kinds: ['openai'],
  async verify(input: CredentialVerifierInput): Promise<VerificationEvidence> {
    const plaintext = decryptSecret(
      input.credential.envelope,
      input.masterKey,
      input.credential.secretContext,
    );
    try {
      let parsedSecret: z.infer<typeof secretSchema>;
      let configuration: z.infer<typeof configurationSchema>;
      try {
        parsedSecret = secretSchema.parse(
          JSON.parse(plaintext.toString('utf8')),
        );
        configuration = configurationSchema.parse(
          input.credential.configuration,
        );
      } catch {
        throw new DomainError(
          'validation_error',
          'OpenAI credential configuration is invalid.',
        );
      }

      let response: Response;
      try {
        response = await (options.fetch ?? globalThis.fetch)(
          `${options.apiBaseUrl ?? 'https://api.openai.com'}/v1/models`,
          {
            headers: { Authorization: `Bearer ${parsedSecret.apiKey}` },
            method: 'GET',
            signal: input.signal,
          },
        );
      } catch {
        throw new DomainError(
          'provider_retryable',
          'OpenAI could not be reached.',
        );
      }
      if (!response.ok) throw mapHttpError(response.status);

      let catalog: z.infer<typeof modelCatalogSchema>;
      try {
        catalog = modelCatalogSchema.parse(await response.json());
      } catch {
        throw new DomainError(
          'provider_final',
          'OpenAI returned an invalid model catalog.',
        );
      }
      const visible = new Set(catalog.data.map((model) => model.id));
      const missing = configuration.requiredModels.filter(
        (model) => !visible.has(model),
      );
      if (missing.length > 0) {
        throw new DomainError(
          'authorization_error',
          'OpenAI credential cannot access all required models.',
          { missingModelCount: String(missing.length) },
        );
      }

      const requestId = response.headers.get('x-request-id');
      return {
        modelCount: catalog.data.length,
        requiredModels: [...configuration.requiredModels].sort(),
        ...(requestId === null ? {} : { requestId }),
      };
    } finally {
      plaintext.fill(0);
    }
  },
});
