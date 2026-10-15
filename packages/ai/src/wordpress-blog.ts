import { DomainError } from '@binflow/domain';
import type { CredentialVerifierInput } from '@binflow/integrations';
import { decryptSecret } from '@binflow/secrets';
import {
  composeGenerationPrompt,
  getNode,
  getTool,
  type EffortLevel,
} from '@binflow/tools';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import { mapOpenAIGenerationError } from './index.js';

const WORDPRESS_BLOG_CAPABILITY_ID = 'create_blog_wordpress';

const secretSchema = z.object({ apiKey: z.string().min(1) }).strict();

const generatedArticleSchema = z
  .object({
    bodyMarkdown: z.string().min(200).max(40_000),
    excerpt: z.string().min(1).max(400),
    imageAlt: z.string().min(1).max(200),
    imagePrompt: z.string().min(1).max(2_000),
    title: z.string().min(3).max(200),
  })
  .strict();

const revisedArticleSchema = z
  .object({
    bodyMarkdown: z.string().min(1).max(40_000),
    excerpt: z.string().max(400),
    title: z.string().min(3).max(200),
  })
  .strict();

const localeName = { de: 'German', en: 'English', es: 'Spanish' } as const;

const MARKDOWN_CONTRACT =
  'Write bodyMarkdown in limited Markdown only: paragraphs separated by blank lines, "## " and "### " headings, "- " or "1. " lists, and **bold**. No HTML, links, images, tables, code, or front matter. Do not repeat the title as a heading.';

export type OpenAIWordpressModelCall = Readonly<{
  estimatedCostCents: number;
  inputTokens: number;
  latencyMs: number;
  model: string;
  outputTokens: number;
  providerRequestId?: string;
}>;

/**
 * Text and image generation for `create_blog_wordpress`. The model receives
 * no tools; output is schema-validated and rendered deterministically by the
 * workflow runtime (ADR-0042, ADR-0067).
 */
export const createOpenAIWordpressBlogGenerationPort = (
  input: Readonly<{
    apiBaseUrl?: string;
    credential: CredentialVerifierInput['credential'];
    masterKey: Buffer;
    onModelCall?: (evidence: OpenAIWordpressModelCall) => Promise<void>;
  }>,
) => {
  const withClient = async <Value>(
    operation: (client: OpenAI) => Promise<Value>,
  ): Promise<Value> => {
    const plaintext = decryptSecret(
      input.credential.envelope,
      input.masterKey,
      input.credential.secretContext,
    );
    try {
      const secret = secretSchema.parse(JSON.parse(plaintext.toString('utf8')));
      const client = new OpenAI({
        apiKey: secret.apiKey,
        ...(input.apiBaseUrl === undefined ? {} : { baseURL: input.apiBaseUrl }),
      });
      return await operation(client);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw mapOpenAIGenerationError(error);
    } finally {
      plaintext.fill(0);
    }
  };

  const record = async (
    model: string,
    startedAt: number,
    usage: { input_tokens?: number; output_tokens?: number } | undefined,
    requestId: string | null | undefined,
    rates: Readonly<{ input: number; output: number }>,
  ): Promise<void> => {
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;
    await input.onModelCall?.({
      estimatedCostCents: Math.ceil(
        (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000,
      ),
      inputTokens,
      latencyMs: Date.now() - startedAt,
      model,
      outputTokens,
      ...(requestId === null || requestId === undefined
        ? {}
        : { providerRequestId: requestId }),
    });
  };

  const textNode = async (nodeId: 'apply_revision' | 'generate', customizationSection?: string) => {
    const tool = await getTool(WORDPRESS_BLOG_CAPABILITY_ID);
    const node = getNode(tool, nodeId);
    const composed = composeGenerationPrompt({
      baseRules: node.rulesMarkdown,
      ...(customizationSection === undefined ? {} : { customizationSection }),
    });
    return {
      composed,
      effort: node.effort ?? ('medium' satisfies EffortLevel),
      maxOutputTokens: node.maxOutputTokens ?? 12_000,
      model: node.model ?? 'gpt-5.6-terra',
    };
  };

  return {
    async generateArticle(
      request: Readonly<{
        baseInformation: string;
        categoryName: string;
        customizationSection?: string;
        locale: 'de' | 'en' | 'es';
        title?: string;
      }>,
    ) {
      return withClient(async (client) => {
        const node = await textNode('generate', request.customizationSection);
        const startedAt = Date.now();
        const response = await client.responses.parse({
          input: [
            {
              content: `${node.composed.system}\n\nWrite one blog article in ${localeName[request.locale]} from the client's base information. Do not invent facts, figures, prices, or claims beyond it. ${MARKDOWN_CONTRACT} The excerpt is a plain-text summary of at most 300 characters. imagePrompt describes a photographic cover image without text or logos.`,
              role: 'system',
            },
            {
              content: JSON.stringify({
                baseInformation: request.baseInformation,
                category: request.categoryName,
                configFingerprint: node.composed.fingerprint,
                rules: node.composed.userRules,
                ...(request.title === undefined ? {} : { fixedTitle: request.title }),
              }),
              role: 'user',
            },
          ],
          max_output_tokens: node.maxOutputTokens,
          model: node.model,
          reasoning: { effort: node.effort },
          text: { format: zodTextFormat(generatedArticleSchema, 'wordpress_article') },
        });
        if (response.output_parsed === null)
          throw new DomainError('provider_final', 'OpenAI returned no structured article.');
        await record(node.model, startedAt, response.usage, response._request_id, {
          input: 250,
          output: 1_500,
        });
        return generatedArticleSchema.parse(response.output_parsed);
      });
    },

    async applyRevision(
      request: Readonly<{
        blogMode: 'as_is' | 'generate';
        customizationSection?: string;
        excerpt: string;
        feedback: string;
        html: string;
        locale: 'de' | 'en' | 'es';
        title: string;
      }>,
    ) {
      return withClient(async (client) => {
        const node = await textNode('apply_revision', request.customizationSection);
        const startedAt = Date.now();
        const preserve =
          request.blogMode === 'as_is'
            ? 'The article is the client\'s own text: change only what the feedback asks for and keep every other word exactly as written.'
            : 'Apply the feedback surgically and keep untouched passages as they are.';
        const response = await client.responses.parse({
          input: [
            {
              content: `${node.composed.system}\n\nRevise the article in ${localeName[request.locale]}. ${preserve} The current body is HTML; return the full revised body. ${MARKDOWN_CONTRACT}`,
              role: 'system',
            },
            {
              content: JSON.stringify({
                configFingerprint: node.composed.fingerprint,
                current: {
                  bodyHtml: request.html.slice(0, 60_000),
                  excerpt: request.excerpt,
                  title: request.title,
                },
                feedback: request.feedback,
                rules: node.composed.userRules,
              }),
              role: 'user',
            },
          ],
          max_output_tokens: node.maxOutputTokens,
          model: node.model,
          reasoning: { effort: node.effort },
          text: { format: zodTextFormat(revisedArticleSchema, 'wordpress_revision') },
        });
        if (response.output_parsed === null)
          throw new DomainError('provider_final', 'OpenAI returned no revised article.');
        await record(node.model, startedAt, response.usage, response._request_id, {
          input: 250,
          output: 1_500,
        });
        return revisedArticleSchema.parse(response.output_parsed);
      });
    },

    async generateImage(
      request: Readonly<{ customizationSection?: string; prompt: string }>,
    ): Promise<Uint8Array> {
      return withClient(async (client) => {
        const tool = await getTool(WORDPRESS_BLOG_CAPABILITY_ID);
        const node = getNode(tool, 'prepare_image');
        const model = node.model ?? 'gpt-image-2';
        const quality =
          node.parameters?.quality === 'medium' || node.parameters?.quality === 'low'
            ? node.parameters.quality
            : 'high';
        const size =
          node.parameters?.size === '1024x1024' || node.parameters?.size === '1024x1536'
            ? node.parameters.size
            : '1536x1024';
        const prompt = [
          request.customizationSection === undefined
            ? undefined
            : `Visual style guidance:\n${request.customizationSection.slice(0, 4_000)}`,
          request.prompt,
          'No text, letters, logos, or watermarks in the image.',
        ]
          .filter((part): part is string => part !== undefined)
          .join('\n\n');
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
          throw new DomainError('provider_final', 'OpenAI returned no image data.');
        await record(model, startedAt, response.usage, undefined, {
          input: 500,
          output: 3_000,
        });
        return new Uint8Array(Buffer.from(encoded, 'base64'));
      });
    },
  };
};
