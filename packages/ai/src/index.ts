import { DomainError } from '@binflow/domain';
import type { BlogGenerationPort, CategoryDecision } from '@binflow/blog';
import {
  assertGeneratedBundleMatchesContentLocales,
  buildBlogGenerateLocaleInstructions,
  isMonolingualContentContract,
  parseGeneratedBlogBundleForLocaleContract,
} from '@binflow/blog';
import type { ProjectGenerationPort } from '@binflow/projects';
import {
  adaptedGeneratedBlogBundleSchema,
  adaptedGeneratedProjectBundleSchema,
  buildGeneratedProjectBundleModelSchema,
  generatedBlogBundleSchema,
  normalizeProjectBundleFromModel,
  projectEstadoSchema,
  projectTipoSchema,
  projectUrlEvidenceSchema,
  revisionPlanModelSchema,
  normalizeRevisionPlanFromModel,
  type CreateBlogDraftInput,
  type CreateProjectDraftInput,
  type GeneratedBlogBundle,
  type GeneratedProjectBundle,
} from '@binflow/contracts';
import type {
  CredentialVerifier,
  CredentialVerifierInput,
  VerificationEvidence,
} from '@binflow/integrations';
import { decryptSecret } from '@binflow/secrets';
import {
  composeGenerationPrompt,
  getNode,
  getTool,
  type EffortLevel,
} from '@binflow/tools';
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

export const mapOpenAIGenerationError = (error: unknown): DomainError => {
  if (error instanceof z.ZodError)
    return new DomainError(
      'provider_final',
      'Model output failed schema validation.',
      {
        detail: error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')
          .slice(0, 500),
      },
    );
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : undefined;
  if (
    message !== undefined &&
    (message.includes('.optional()') ||
      message.includes('all fields must be required') ||
      message.includes('Structured Outputs') ||
      message.includes('structured outputs') ||
      message.includes('which is not supported by the API'))
  )
    return new DomainError(
      'provider_final',
      'OpenAI structured output schema is invalid.',
      { detail: message.slice(0, 500) },
    );
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
      message === undefined ? {} : { detail: message.slice(0, 500) },
    );
  const name =
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
      ? error.name
      : undefined;
  if (
    name === 'LengthFinishReasonError' ||
    name === 'ContentFilterFinishReasonError'
  )
    return new DomainError(
      'provider_final',
      'OpenAI generation finished without usable structured output.',
      { detail: name },
    );
  return new DomainError(
    'provider_retryable',
    'OpenAI generation could not be completed.',
    message === undefined ? {} : { detail: message.slice(0, 500) },
  );
};

const clipArticleText = (value: string, maxChars = 8_000): string =>
  value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}\n…[truncated]`;

const priorArticleContext = (bundle: GeneratedBlogBundle) => ({
  category: bundle.category,
  categoryKind: bundle.categoryKind,
  en: {
    body: clipArticleText(bundle.en.body),
    descripcion: bundle.en.descripcion,
    faq: bundle.en.faq,
    imagenAlt: bundle.en.imagenAlt,
    keywords: bundle.en.keywords,
    seoTitulo: bundle.en.seoTitulo,
    titulo: bundle.en.titulo,
  },
  es: {
    body: clipArticleText(bundle.es.body),
    descripcion: bundle.es.descripcion,
    faq: bundle.es.faq,
    imagenAlt: bundle.es.imagenAlt,
    keywords: bundle.es.keywords,
    seoTitulo: bundle.es.seoTitulo,
    titulo: bundle.es.titulo,
  },
  imagePrompt: clipArticleText(bundle.imagePrompt, 2_000),
  slug: bundle.slug,
});

const generationSecretSchema = z.object({ apiKey: z.string().min(1) }).strict();
const proposedTopicSchema = z
  .object({
    topic: z.string().trim().min(1).max(500),
  })
  .strict();

export const createOpenAIBlogGenerationPort = (
  input: Readonly<{
    apiBaseUrl?: string;
    capabilityId: string;
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
      if (error instanceof DomainError) throw error;
      throw mapOpenAIGenerationError(error);
    } finally {
      plaintext.fill(0);
    }
  };

  const requestText = (
    request: CreateBlogDraftInput,
    category: CategoryDecision,
    rules: Readonly<Record<string, unknown>>,
  ): string =>
    JSON.stringify({
      category,
      request,
      rules,
    });

  return {
    async proposeTopic({ context, locale }) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'interpret_brief');
        const model = node.model ?? 'gpt-5.6-luna';
        const effort: EffortLevel = node.effort ?? 'low';
        const maxOutputTokens = node.maxOutputTokens ?? 200;
        const startedAt = Date.now();
        const response = await client.responses.parse({
          input: [
            {
              content:
                'Propose a concise blog topic (max 500 characters) that captures the client brief. Return only the topic field. Do not invent facts beyond the brief. Prefer the conversation locale when stated.',
              role: 'system',
            },
            {
              content: JSON.stringify({
                brief: context,
                ...(locale === undefined ? {} : { locale }),
              }),
              role: 'user',
            },
          ],
          max_output_tokens: maxOutputTokens,
          model,
          reasoning: { effort },
          text: {
            format: zodTextFormat(proposedTopicSchema, 'blog_brief_topic'),
          },
        });
        if (response.output_parsed === null)
          throw new DomainError(
            'provider_final',
            'OpenAI returned no structured topic proposal.',
          );
        await input.onModelCall?.({
          estimatedCostCents: Math.ceil(
            ((response.usage?.input_tokens ?? 0) * 250 +
              (response.usage?.output_tokens ?? 0) * 1_500) /
              1_000_000,
          ),
          inputTokens: response.usage?.input_tokens ?? 0,
          latencyMs: Date.now() - startedAt,
          model,
          outputTokens: response.usage?.output_tokens ?? 0,
          ...(response._request_id === null ||
          response._request_id === undefined
            ? {}
            : { providerRequestId: response._request_id }),
        });
        return proposedTopicSchema.parse(response.output_parsed).topic;
      });
    },
    async interpretRevision({ bundle, feedback, locale }) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'interpret_revision');
        const model = node.model ?? 'gpt-5.6-luna';
        const effort: EffortLevel = node.effort ?? 'medium';
        const maxOutputTokens = node.maxOutputTokens ?? 4_000;
        const startedAt = Date.now();
        const response = await client.responses.parse({
          input: [
            {
              content:
                node.rulesMarkdown ||
                'Classify revision feedback into a structured RevisionPlan. Prefer the minimum surgical magnitude; body_patch covers word/paragraph add/edit/delete.',
              role: 'system',
            },
            {
              content: JSON.stringify({
                feedback,
                priorArticle: priorArticleContext(bundle),
                ...(locale === undefined ? {} : { locale }),
              }),
              role: 'user',
            },
          ],
          max_output_tokens: maxOutputTokens,
          model,
          reasoning: { effort },
          text: {
            format: zodTextFormat(revisionPlanModelSchema, 'revision_plan'),
          },
        });
        if (response.output_parsed === null)
          throw new DomainError(
            'provider_final',
            'OpenAI returned no structured revision plan.',
          );
        await input.onModelCall?.({
          estimatedCostCents: Math.ceil(
            ((response.usage?.input_tokens ?? 0) * 250 +
              (response.usage?.output_tokens ?? 0) * 1_500) /
              1_000_000,
          ),
          inputTokens: response.usage?.input_tokens ?? 0,
          latencyMs: Date.now() - startedAt,
          model,
          outputTokens: response.usage?.output_tokens ?? 0,
          ...(response._request_id === null ||
          response._request_id === undefined
            ? {}
            : { providerRequestId: response._request_id }),
        });
        try {
          return normalizeRevisionPlanFromModel(response.output_parsed);
        } catch (error) {
          throw mapOpenAIGenerationError(error);
        }
      });
    },
    async applyRevisionPatch({ bundle, customizationSection, plan }) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'apply_revision');
        const composed = composeGenerationPrompt({
          baseRules: node.rulesMarkdown,
          ...(customizationSection === undefined
            ? {}
            : { customizationSection }),
        });
        const model = node.model ?? 'gpt-5.6-terra';
        const effort: EffortLevel = node.effort ?? 'medium';
        const maxOutputTokens = node.maxOutputTokens ?? 12_000;
        const startedAt = Date.now();
        const response = await client.responses.parse({
          input: [
            {
              content: `${composed.system}\n\nApply only the confirmed revision plan surgically. Interpret natural-language patch_body instructions (word edits, paragraph add/remove/rewrite, deletions, new facts). Preserve untouched fields. Do not widen scope.`,
              role: 'system',
            },
            {
              content: JSON.stringify({
                bundle,
                configFingerprint: composed.fingerprint,
                plan,
                rules: composed.userRules,
              }),
              role: 'user',
            },
          ],
          max_output_tokens: maxOutputTokens,
          model,
          reasoning: { effort },
          text: {
            format: zodTextFormat(
              generatedBlogBundleSchema,
              'revised_blog_bundle',
            ),
          },
        });
        if (response.output_parsed === null)
          throw new DomainError(
            'provider_final',
            'OpenAI returned no revised blog bundle.',
          );
        await input.onModelCall?.({
          estimatedCostCents: Math.ceil(
            ((response.usage?.input_tokens ?? 0) * 250 +
              (response.usage?.output_tokens ?? 0) * 1_500) /
              1_000_000,
          ),
          inputTokens: response.usage?.input_tokens ?? 0,
          latencyMs: Date.now() - startedAt,
          model,
          outputTokens: response.usage?.output_tokens ?? 0,
          ...(response._request_id === null ||
          response._request_id === undefined
            ? {}
            : { providerRequestId: response._request_id }),
        });
        try {
          return adaptedGeneratedBlogBundleSchema.parse(response.output_parsed);
        } catch (error) {
          throw mapOpenAIGenerationError(error);
        }
      });
    },
    async embed(texts) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'similarity');
        const model = node.model ?? 'text-embedding-3-small';
        const startedAt = Date.now();
        const response = await client.embeddings.create({
          encoding_format: 'float',
          input: [...texts],
          model,
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
          model,
          outputTokens: 0,
        });
        return ordered.map((item) => item.embedding);
      });
    },
    async generate({
      catalog,
      category,
      customizationSection,
      editorial,
      localeContract,
      request,
    }) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'generate');
        const composed = composeGenerationPrompt({
          baseRules: node.rulesMarkdown,
          ...(customizationSection === undefined
            ? {}
            : { customizationSection }),
          ...(editorial === undefined ? {} : { editorial }),
        });
        const model = node.model ?? 'gpt-5.6-terra';
        const effort: EffortLevel = node.effort ?? 'medium';
        const maxOutputTokens = node.maxOutputTokens ?? 20_000;
        const catalogSummary = JSON.stringify(
          catalog.map((item) => ({
            category: item.category,
            slug: item.slug,
            title: item.title,
          })),
        );
        const localeInstructions =
          localeContract === undefined
            ? ''
            : `\n\n${buildBlogGenerateLocaleInstructions(localeContract)}`;
        const requestPayload = `${requestText(request, category, composed.userRules)}\nConfigFingerprint:${composed.fingerprint}\nCurrent catalog summary:\n${catalogSummary}${
          localeContract === undefined
            ? ''
            : `\nLocaleContract:${JSON.stringify(localeContract)}`
        }`;
        const monolingual =
          localeContract !== undefined &&
          isMonolingualContentContract(localeContract);
        const parseBundle = (parsed: unknown): GeneratedBlogBundle => {
          let bundle: GeneratedBlogBundle;
          try {
            bundle = parseGeneratedBlogBundleForLocaleContract(
              parsed,
              localeContract,
            );
          } catch (error) {
            if (monolingual) throw error;
            throw new DomainError(
              'provider_retryable',
              'English article fields copied the Spanish source.',
              { code: 'english_copies_spanish' },
            );
          }
          if (localeContract !== undefined)
            assertGeneratedBundleMatchesContentLocales(bundle, localeContract);
          return bundle;
        };
        const run = async (system: string) => {
          const startedAt = Date.now();
          const response = await client.responses.parse({
            input: [
              { content: system, role: 'system' },
              { content: requestPayload, role: 'user' },
            ],
            max_output_tokens: maxOutputTokens,
            model,
            reasoning: { effort },
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
            model,
            outputTokens: response.usage?.output_tokens ?? 0,
            ...(response._request_id === null ||
            response._request_id === undefined
              ? {}
              : { providerRequestId: response._request_id }),
          });
          return response.output_parsed;
        };
        const system = `${composed.system}${localeInstructions}`;
        try {
          return parseBundle(await run(system));
        } catch (error) {
          const code =
            error instanceof DomainError ? error.metadata.code : undefined;
          const localeMismatch =
            code === 'content_locale_mismatch' ||
            code === 'content_locale_conversation_bleed' ||
            code === 'content_locale_unverified';
          const englishCopy = code === 'english_copies_spanish';
          if (
            error instanceof DomainError &&
            error.category === 'provider_retryable' &&
            localeMismatch
          ) {
            const expected =
              localeContract?.defaultContentLocale ??
              localeContract?.contentLocales[0] ??
              'de';
            return parseBundle(
              await run(
                `${system}\n\nRetry HARD: rewrite the primary article entirely in ${expected}. Schema "es" fields must contain ${expected} prose only. Conversation language must not appear in titulo/body. Keep "en" as a short distinct English synopsis.`,
              ),
            );
          }
          if (
            error instanceof DomainError &&
            error.category === 'provider_retryable' &&
            englishCopy &&
            !monolingual
          ) {
            return parseBundle(
              await run(
                `${system}\n\nRetry: write a distinct English titulo, seoTitulo and headings; do not reuse the Spanish title or H2/H3 text.`,
              ),
            );
          }
          throw error;
        }
      });
    },
    async generateImage(prompt) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'prepare_image');
        const model = node.model ?? 'gpt-image-2';
        const quality =
          node.parameters?.quality === 'high' ||
          node.parameters?.quality === 'medium' ||
          node.parameters?.quality === 'low'
            ? node.parameters.quality
            : 'high';
        const size =
          node.parameters?.size === '1536x1024' ||
          node.parameters?.size === '1024x1024' ||
          node.parameters?.size === '1024x1536'
            ? node.parameters.size
            : '1536x1024';
        const startedAt = Date.now();
        const response = await client.images.generate({
          background: 'opaque',
          model,
          output_format: 'png',
          prompt,
          quality,
          size,
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
          model,
          outputTokens: response.usage?.output_tokens ?? 0,
        });
        return new Uint8Array(Buffer.from(encoded, 'base64'));
      });
    },
  };
};

export const createOpenAIProjectGenerationPort = (
  input: Readonly<{
    apiBaseUrl?: string;
    capabilityId: string;
    credential: CredentialVerifierInput['credential'];
    masterKey: Buffer;
    onModelCall?: (evidence: Readonly<{
      estimatedCostCents: number;
      inputTokens: number;
      latencyMs: number;
      model: string;
      outputTokens: number;
      providerRequestId?: string;
    }>) => Promise<void>;
  }>,
): ProjectGenerationPort => {
  const withClient = async <Value>(
    operation: (client: OpenAI) => Promise<Value>,
  ): Promise<Value> => {
    const plaintext = decryptSecret(
      input.credential.envelope,
      input.masterKey,
      input.credential.secretContext,
    );
    try {
      const secret = secretSchema.parse(
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
      if (error instanceof DomainError) throw error;
      throw mapOpenAIGenerationError(error);
    } finally {
      plaintext.fill(0);
    }
  };

  return {
    async embed(texts) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'similarity');
        const model = node.model ?? 'text-embedding-3-small';
        const startedAt = Date.now();
        const response = await client.embeddings.create({
          encoding_format: 'float',
          input: [...texts],
          model,
        });
        const ordered = [...response.data].sort(
          (left, right) => left.index - right.index,
        );
        await input.onModelCall?.({
          estimatedCostCents: Math.ceil(
            (response.usage.prompt_tokens * 2) / 1_000_000,
          ),
          inputTokens: response.usage.prompt_tokens,
          latencyMs: Date.now() - startedAt,
          model,
          outputTokens: 0,
        });
        return ordered.map((item) => item.embedding);
      });
    },
    async extractUrlEvidence({ pageText, sourceUrl }) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'read_project_url');
        const model = node.model ?? 'gpt-5.6-luna';
        const effort: EffortLevel = node.effort ?? 'low';
        const maxOutputTokens = node.maxOutputTokens ?? 2_000;
        const response = await client.responses.parse({
          input: [
            {
              content:
                'Extract factual evidence from the provided project page text. Do not invent services, claims, or stack items that are not grounded in the text. Prefer concise summaries useful for a portfolio case study.',
              role: 'system',
            },
            {
              content: JSON.stringify({
                pageText: pageText.slice(0, 20_000),
                sourceUrl,
              }),
              role: 'user',
            },
          ],
          max_output_tokens: maxOutputTokens,
          model,
          reasoning: { effort },
          text: {
            format: zodTextFormat(projectUrlEvidenceSchema, 'project_url_evidence'),
          },
        });
        if (response.output_parsed === null)
          throw new DomainError(
            'provider_final',
            'OpenAI returned no structured project URL evidence.',
          );
        return projectUrlEvidenceSchema.parse({
          ...response.output_parsed,
          sourceUrl,
        });
      });
    },
    async generate({ catalog, customizationSection, manifest, request }) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'generate');
        const composed = composeGenerationPrompt({
          baseRules: node.rulesMarkdown,
          ...(customizationSection === undefined
            ? {}
            : { customizationSection }),
        });
        const portfolioEnums = manifest.content.portfolio?.enumFields;
        const modelSchema = buildGeneratedProjectBundleModelSchema(portfolioEnums);
        const model = node.model ?? 'gpt-5.6-terra';
        const effort: EffortLevel = node.effort ?? 'medium';
        const maxOutputTokens = node.maxOutputTokens ?? 20_000;
        const response = await client.responses.parse({
          input: [
            {
              content: composed.system,
              role: 'system',
            },
            {
              content: JSON.stringify({
                catalog: catalog.map((item) => ({
                  slug: item.slug,
                  title: item.title,
                })),
                configFingerprint: composed.fingerprint,
                portfolioEnums: portfolioEnums ?? null,
                request,
                rules: composed.userRules,
              }),
              role: 'user',
            },
          ],
          max_output_tokens: maxOutputTokens,
          model,
          reasoning: { effort },
          text: {
            format: zodTextFormat(
              modelSchema,
              'project_bundle',
            ),
          },
        });
        if (response.output_parsed === null)
          throw new DomainError(
            'provider_final',
            'OpenAI returned no structured project bundle.',
          );
        try {
          return adaptedGeneratedProjectBundleSchema.parse(
            normalizeProjectBundleFromModel(response.output_parsed),
          );
        } catch (error) {
          throw mapOpenAIGenerationError(error);
        }
      });
    },
    async generateImage(prompt) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'prepare_image');
        const model = node.model ?? 'gpt-image-2';
        const response = await client.images.generate({
          background: 'opaque',
          model,
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
        return new Uint8Array(Buffer.from(encoded, 'base64'));
      });
    },
    async interpretRevision({ bundle, feedback, locale }) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'interpret_revision');
        const model = node.model ?? 'gpt-5.6-luna';
        const effort: EffortLevel = node.effort ?? 'medium';
        const response = await client.responses.parse({
          input: [
            {
              content: node.rulesMarkdown,
              role: 'system',
            },
            {
              content: JSON.stringify({ bundle, feedback, locale }),
              role: 'user',
            },
          ],
          max_output_tokens: node.maxOutputTokens ?? 4_000,
          model,
          reasoning: { effort },
          text: {
            format: zodTextFormat(revisionPlanModelSchema, 'revision_plan'),
          },
        });
        if (response.output_parsed === null)
          throw new DomainError(
            'provider_final',
            'OpenAI returned no structured revision plan.',
          );
        return normalizeRevisionPlanFromModel(response.output_parsed);
      });
    },
    async applyRevisionPatch({ bundle, customizationSection, plan }) {
      return withClient(async (client) => {
        const tool = await getTool(input.capabilityId);
        const node = getNode(tool, 'apply_revision');
        const composed = composeGenerationPrompt({
          baseRules: node.rulesMarkdown,
          ...(customizationSection === undefined
            ? {}
            : { customizationSection }),
        });
        const model = node.model ?? 'gpt-5.6-terra';
        const effort: EffortLevel = node.effort ?? 'medium';
        const revisionModelSchema = buildGeneratedProjectBundleModelSchema({
          estado: projectEstadoSchema.options,
          tipo: projectTipoSchema.options,
        });
        const response = await client.responses.parse({
          input: [
            {
              content: `${composed.system}\n\nApply only the confirmed revision plan surgically.`,
              role: 'system',
            },
            {
              content: JSON.stringify({ bundle, plan, rules: composed.userRules }),
              role: 'user',
            },
          ],
          max_output_tokens: node.maxOutputTokens ?? 12_000,
          model,
          reasoning: { effort },
          text: {
            format: zodTextFormat(
              revisionModelSchema,
              'revised_project_bundle',
            ),
          },
        });
        if (response.output_parsed === null)
          throw new DomainError(
            'provider_final',
            'OpenAI returned no revised project bundle.',
          );
        return adaptedGeneratedProjectBundleSchema.parse(
          normalizeProjectBundleFromModel(response.output_parsed),
        );
      });
    },
  };
};
