import { DomainError } from '@binflow/domain';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const heyBinnReplySchema = z
  .object({
    askConfirmHandoff: z.boolean(),
    reply: z.string().min(1).max(4_000),
    suggestedToolCommand: z.string().min(1).max(80).nullable(),
    typedHandoff: z.string().min(1).max(4_000).nullable(),
  })
  .strict();

export type OpenAIHeyBinnInput = Readonly<{
  enabledTools: ReadonlyArray<
    Readonly<{ command: string; displayName: string }>
  >;
  locale: 'de' | 'en' | 'es';
  message: string;
  projectContext: Readonly<{
    inventory: Readonly<{
      collections: ReadonlyArray<
        Readonly<{ directory: string; locale: string; routePrefix: string }>
      >;
      items: ReadonlyArray<
        Readonly<{
          category?: string;
          excerpt?: string;
          kind: 'blog' | 'page' | 'portfolio' | 'surface';
          locale?: string;
          slug?: string;
          sourceId?: string;
          title: string;
        }>
      >;
      notes: string;
      source: 'github' | 'github+cms' | 'cms' | 'manifest_only';
    }>;
    profile: string;
    productionOrigin: string | null;
    repository: string | null;
    tenantKey: string;
  }>;
}>;

export type OpenAIHeyBinnResult = z.infer<typeof heyBinnReplySchema>;

export const HEY_BINN_CHAT_MODEL = 'gpt-5.6-luna' as const;

/**
 * Text-only advisor for `/hey_binn` (ADR-0062).
 * No tools exposed to the model — suggest only; never mutate or invoke.
 * Site/blog inventory is injected by deterministic application code.
 */
export const createOpenAIHeyBinnPort = (input: Readonly<{
  apiBaseUrl?: string;
  apiKey: string;
  model?: string;
}>): ((
  chatInput: OpenAIHeyBinnInput,
) => Promise<
  OpenAIHeyBinnResult &
    Readonly<{
      estimatedCostCents: number;
      inputTokens: number;
      latencyMs: number;
      model: string;
      outputTokens: number;
      providerRequestId?: string;
    }>
>) => {
  const client = new OpenAI({
    apiKey: input.apiKey,
    ...(input.apiBaseUrl === undefined ? {} : { baseURL: input.apiBaseUrl }),
  });
  const model = input.model ?? HEY_BINN_CHAT_MODEL;
  return async (chatInput) => {
    const language =
      chatInput.locale === 'es'
        ? 'Spanish'
        : chatInput.locale === 'de'
          ? 'German'
          : 'English';
    const startedAt = Date.now();
    const response = await client.responses.parse({
      input: [
        {
          content: [
            `You are Binn, a read-only advisor for website clients on Binflow.`,
            `Reply in ${language}. Be concise and practical.`,
            `You help invent/refine content ideas and prepare strong input for an enabled tool.`,
            `Deterministic application code already loaded allowlisted project inventory into projectContext.inventory.`,
            `Each inventory item may include title/slug/metadata and an optional excerpt of real blog/page/theme copy (truncated).`,
            `When the client asks about existing content, summarize from those excerpts. Do not claim you lack read access when inventory.items is non-empty.`,
            `If inventory.items is empty or excerpts are missing, say so and suggest /tools or asking the operator — never invent posts or page copy.`,
            `The client command is exactly /hey_binn (never /hey-bin or other misspellings). End chat with /bye_binn.`,
            `You NEVER mutate content, invoke tools, open tickets, merge, publish, or invent credentials.`,
            `You may suggest one enabled tool command (or /open_ticket) when helpful.`,
            `If askConfirmHandoff is true, set typedHandoff to a ready-to-paste message the client can use when THEY start that tool; otherwise typedHandoff is null.`,
            `Only set askConfirmHandoff true when you have a concrete typedHandoff and a suggestedToolCommand from the enabled list (or /open_ticket).`,
            `Do not claim you already ran a tool or created a draft.`,
          ].join(' '),
          role: 'system',
        },
        {
          content: JSON.stringify({
            enabledTools: chatInput.enabledTools,
            message: chatInput.message,
            projectContext: chatInput.projectContext,
          }),
          role: 'user',
        },
      ],
      model,
      text: {
        format: zodTextFormat(heyBinnReplySchema, 'hey_binn_reply'),
      },
    });
    if (response.output_parsed === null)
      throw new DomainError(
        'provider_final',
        'Hey Binn model returned no parse.',
      );
    const parsed = heyBinnReplySchema.parse(response.output_parsed);
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    return {
      ...parsed,
      estimatedCostCents: Math.ceil(
        (inputTokens * 250 + outputTokens * 1_500) / 1_000_000,
      ),
      inputTokens,
      latencyMs: Date.now() - startedAt,
      model,
      outputTokens,
      ...(response._request_id === null || response._request_id === undefined
        ? {}
        : { providerRequestId: response._request_id }),
    };
  };
};
