import type { Locale } from 'shared';
import type { AiToolSpec } from './ai.client';
import { asObject, optionalEnum, requiredString } from './ai.validation';
import type { ChatCall } from './chat.functions';

const LANGUAGE: Record<Locale, string> = {
  'uz-latn': 'Uzbek, Latin script',
  'uz-cyrl': 'Uzbek, Cyrillic script',
  ru: 'Russian',
};

/** Chart the panel should draw next to the answer (TZ §8.4). */
export const CHART_TYPES = ['none', 'bar', 'line', 'pie'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** Step 1 — pick the query. The model is told plainly it has no other way in. */
export function chatRouterPrompt(today: Date): string {
  return [
    "You route an owner's question about their trucking company to exactly one",
    'prepared query. You cannot read the database and you cannot write SQL —',
    'choosing the right query with the right period is your whole job.',
    '',
    `Today is ${today.toISOString().slice(0, 10)} (UTC).`,
    'Turn words like "this month", "last month" or "in July" into explicit ISO',
    'dates. When the question names no period at all, leave the dates out and the',
    'system will use the current month.',
    'If the question names a truck, a driver or a route, pass it through as given.',
  ].join('\n');
}

/** Step 2 — write the answer. The figures are handed over; none may be invented. */
export function chatAnswerPrompt(locale: Locale): string {
  return [
    "You answer an owner's question about their trucking company. The system has",
    'already run the query and given you the result.',
    '',
    'Rules:',
    '- Use only the figures in the result. Never calculate a new one, and never',
    '  fill a gap with a plausible number.',
    "- Money arrives in tiyin (1 so'm = 100 tiyin); write sums in so'm.",
    '- Ratios arrive in basis points (100 bp = 1%); write them as percentages.',
    '- Lead with the answer, then the two or three figures that support it.',
    '- Say what the answer is based on — how many trips, vehicles or records.',
    '- If the result is empty, say there is no data for that period. Do not guess.',
    `- Write in ${LANGUAGE[locale]}. Keep it short: this is read on a phone.`,
  ].join('\n');
}

export const CHAT_ANSWER_TOOL: AiToolSpec = {
  name: 'answer_question',
  description: 'Answer the question from the query result.',
  schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'The answer, in the requested language.' },
      chart: {
        type: 'string',
        enum: [...CHART_TYPES],
        description: 'Chart that would help, or "none" if a number says it better.',
      },
    },
    required: ['answer'],
  },
};

export interface ChatAnswer {
  answer: string;
  chart: ChartType;
}

export function parseChatAnswer(raw: unknown): ChatAnswer {
  const source = asObject(raw);
  return {
    answer: requiredString(source, 'answer', 3000),
    chart: optionalEnum(source, 'chart', CHART_TYPES) ?? 'none',
  };
}

/**
 * The query result, written out for the model. Values are serialised as-is —
 * BigInt becomes its digits, so no rounding happens on the way to the sentence.
 */
export function chatResultMessage(question: string, call: ChatCall, result: unknown): string {
  return [
    `Question: ${question}`,
    `Query run: ${call.name}`,
    `Period: ${call.period.fromDate.toISOString()} … ${call.period.toDate.toISOString()}`,
    call.comparePeriod
      ? `Compared with: ${call.comparePeriod.fromDate.toISOString()} … ${call.comparePeriod.toDate.toISOString()}`
      : '',
    'Result:',
    JSON.stringify(result, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
  ]
    .filter(Boolean)
    .join('\n');
}
