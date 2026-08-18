import { DomainError } from '@binflow/domain';
import type { BlogGenerationPort, CategoryDecision } from '@binflow/blog';
import {
  generatedBlogBundleSchema,
  type CreateBlogDraftInput,
} from '@binflow/contracts';
import type {
  CredentialVerifier,
  CredentialVerifierInput,
  VerificationEvidence,
} from '@binflow/integrations';
import { decryptSecret } from '@binflow/secrets';
import { z } from 'zod';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';

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

const mapOpenAIGenerationError = (error: unknown): DomainError => {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : undefined;
  if (status === 401)
    return new DomainError(
      'authentication_error',
      'OpenAI rejected the credential.',
    );
  if (status === 403)
    return new DomainError(
      'authorization_error',
      'OpenAI denied the generation operation.',
    );
  if (status === 429 || (status !== undefined && status >= 500))
    return new DomainError(
      'provider_retryable',
      'OpenAI is temporarily unavailable.',
    );
  if (status !== undefined)
    return new DomainError(
      'provider_final',
      'OpenAI rejected the generation request.',
    );
  return new DomainError(
    'provider_retryable',
    'OpenAI generation could not be completed.',
  );
};

const generationSecretSchema = z.object({ apiKey: z.string().min(1) }).strict();

export const createOpenAIBlogGenerationPort = (
  input: Readonly<{
    apiBaseUrl?: string;
    credential: CredentialVerifierInput['credential'];
    masterKey: Buffer;
    onModelCall?: (
      evidence: Readonly<{
        estimatedCostCents: number;
        inputTokens: number;
        latencyMs: number;
        model: string;
        outputTokens: number;
        providerRequestId?: string;
      }>,
    ) => Promise<void>;
  }>,
): BlogGenerationPort => {
  const withClient = async <Value>(
    operation: (client: OpenAI) => Promise<Value>,
  ): Promise<Value> => {
    const plaintext = decryptSecret(
      input.credential.envelope,
      input.masterKey,
      input.credential.secretContext,
    );
    try {
      const secret = generationSecretSchema.parse(
        JSON.parse(plaintext.toString('utf8')),
      );
      const client = new OpenAI({
        apiKey: secret.apiKey,
        ...(input.apiBaseUrl === undefined
          ? {}
          : { baseURL: input.apiBaseUrl }),
      });
      return await operation(client);
    } catch (error) {
      if (error instanceof DomainError || error instanceof z.ZodError)
        throw error;
      throw mapOpenAIGenerationError(error);
    } finally {
      plaintext.fill(0);
    }
  };

  const requestText = (
    request: CreateBlogDraftInput,
    category: CategoryDecision,
  ): string =>
    JSON.stringify({
      category,
      request,
      rules: {
        avoidInventedClaims: true,
        englishIsIdiomaticAdaptation: true,
        sourceLocale: 'es',
        requiredLocales: ['es', 'en'],
      },
    });

  return {
    async embed(texts) {
      return withClient(async (client) => {
        const startedAt = Date.now();
        const response = await client.embeddings.create({
          encoding_format: 'float',
          input: [...texts],
          model: 'text-embedding-3-small',
        });
        const ordered = [...response.data].sort(
          (left, right) => left.index - right.index,
        );
        if (
          ordered.length !== texts.length ||
          ordered.some((item, index) => item.index !== index)
        )
          throw new DomainError(
            'provider_final',
            'OpenAI returned incomplete embedding data.',
          );
        await input.onModelCall?.({
          estimatedCostCents: Math.ceil(
            (response.usage.prompt_tokens * 2) / 1_000_000,
          ),
          inputTokens: response.usage.prompt_tokens,
          latencyMs: Date.now() - startedAt,
          model: 'text-embedding-3-small',
          outputTokens: 0,
        });
        return ordered.map((item) => item.embedding);
      });
    },
    async generate({ catalog, category, request }) {
      return withClient(async (client) => {
        const startedAt = Date.now();
        const response = await client.responses.parse({
          input: [
            {
              content:
                'Create a complete Webbin editorial article bundle. Spanish is the source. English must preserve claims while adapting idiom. Use only supported facts from the request; expose limitations instead of inventing evidence. Body Markdown must have useful headings, practical detail and no frontmatter.',
              role: 'system',
            },
            {
              content: `${requestText(request, category)}\nCurrent catalog summary:\n${JSON.stringify(
                catalog.map((item) => ({
                  category: item.category,
                  slug: item.slug,
                  title: item.title,
                })),
              )}`,
              role: 'user',
            },
          ],
          max_output_tokens: 20_000,
          model: 'gpt-5.6-terra',
          reasoning: { effort: 'medium' },
          text: {
            format: zodTextFormat(
              generatedBlogBundleSchema,
              'webbin_blog_bundle',
            ),
          },
        });
        if (response.output_parsed === null)
          throw new DomainError(
            'provider_final',
            'OpenAI returned no structured blog bundle.',
          );
        await input.onModelCall?.({
          estimatedCostCents: Math.ceil(
            ((response.usage?.input_tokens ?? 0) * 250 +
              (response.usage?.output_tokens ?? 0) * 1_500) /
              1_000_000,
          ),
          inputTokens: response.usage?.input_tokens ?? 0,
          latencyMs: Date.now() - startedAt,
          model: 'gpt-5.6-terra',
          outputTokens: response.usage?.output_tokens ?? 0,
          ...(response._request_id === null ||
          response._request_id === undefined
            ? {}
            : { providerRequestId: response._request_id }),
        });
        return generatedBlogBundleSchema.parse(response.output_parsed);
      });
    },
    async generateImage(prompt) {
      return withClient(async (client) => {
        const startedAt = Date.now();
        const response = await client.images.generate({
          background: 'opaque',
          model: 'gpt-image-2',
          output_format: 'png',
          prompt,
          quality: 'high',
          size: '1536x1024',
        });
        const encoded = response.data?.[0]?.b64_json;
        if (encoded === undefined)
          throw new DomainError(
            'provider_final',
            'OpenAI returned no image data.',
          );
        await input.onModelCall?.({
          estimatedCostCents: Math.ceil(
            ((response.usage?.input_tokens ?? 0) * 500 +
              (response.usage?.output_tokens ?? 0) * 3_000) /
              1_000_000,
          ),
          inputTokens: response.usage?.input_tokens ?? 0,
          latencyMs: Date.now() - startedAt,
          model: 'gpt-image-2',
          outputTokens: response.usage?.output_tokens ?? 0,
        });
        return new Uint8Array(Buffer.from(encoded, 'base64'));
      });
    },
  };
};
