import { DomainError } from '@binflow/domain';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const ticketEstimateSchema = z
  .object({
    effortEstimate: z.string().min(1).max(2_000),
    summary: z.string().min(1).max(8_000),
    title: z.string().min(1).max(240),
  })
  .strict();

export type OpenAITicketEstimateInput = Readonly<{
  intent: string;
  kind: 'improvement' | 'style' | 'bug';
  locale: 'de' | 'en' | 'es';
  requirement: string;
  scope: string;
  urgency: 'low' | 'normal' | 'high' | 'urgent';
}>;

export type OpenAITicketEstimateResult = z.infer<typeof ticketEstimateSchema>;

/**
 * Text-only LLM summary + effort estimate for `/open_ticket` (ADR-0055).
 * No tools exposed to the model.
 */
export const createOpenAITicketEstimatePort = (input: Readonly<{
  apiBaseUrl?: string;
  apiKey: string;
  model?: string;
}>): ((
  estimateInput: OpenAITicketEstimateInput,
) => Promise<OpenAITicketEstimateResult>) => {
  const client = new OpenAI({
    apiKey: input.apiKey,
    ...(input.apiBaseUrl === undefined ? {} : { baseURL: input.apiBaseUrl }),
  });
  const model = input.model ?? 'gpt-5.6-luna';
  return async (estimateInput) => {
    const language =
      estimateInput.locale === 'es'
        ? 'Spanish'
        : estimateInput.locale === 'de'
          ? 'German'
          : 'English';
    const response = await client.responses.parse({
      input: [
        {
          content: `You help non-technical website clients. Reply in ${language}. Produce a clear non-technical title, structured summary, and effort/time estimate. Never invent credentials, code, or publication steps.`,
          role: 'system',
        },
        {
          content: JSON.stringify({
            intent: estimateInput.intent,
            kind: estimateInput.kind,
            requirement: estimateInput.requirement,
            scope: estimateInput.scope,
            urgency: estimateInput.urgency,
          }),
          role: 'user',
        },
      ],
      model,
      text: {
        format: zodTextFormat(ticketEstimateSchema, 'ticket_estimate'),
      },
    });
    if (response.output_parsed === null)
      throw new DomainError(
        'provider_final',
        'Ticket estimate model returned no parse.',
      );
    return ticketEstimateSchema.parse(response.output_parsed);
  };
};
