import type { Locale } from 'shared';
import type { AiToolSpec } from './ai.client';
import { asObject, requiredString } from './ai.validation';
import type { DigestFacts } from './digest.facts';

const LANGUAGE: Record<Locale, string> = {
  'uz-latn': 'Uzbek, Latin script',
  'uz-cyrl': 'Uzbek, Cyrillic script',
  ru: 'Russian',
};

/** One Telegram message a day (TZ §8.9) — short enough to read on a lock screen. */
export function digestSystemPrompt(locale: Locale): string {
  return [
    'You write the end-of-day message an owner of a small trucking company gets',
    'on Telegram. It is the only message they get today, so it has to be short',
    'and complete: what moved, what it earned, and what needs them.',
    '',
    'Rules:',
    '- Use only the figures given. Never calculate a new one and never round.',
    "- Money arrives in tiyin (1 so'm = 100 tiyin); write it in so'm.",
    '- Plain text, no Markdown. A few emoji as section markers are fine.',
    '- Six short lines at most. Anything needing attention goes last, so it is',
    '  the thing left on the screen.',
    `- Write in ${LANGUAGE[locale]}.`,
  ].join('\n');
}

export const DIGEST_TOOL: AiToolSpec = {
  name: 'write_digest',
  description: 'Write the daily digest message.',
  schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The message, ready to send as plain text.' },
    },
    required: ['message'],
  },
};

export function parseDigest(raw: unknown): { message: string } {
  const source = asObject(raw);
  return { message: requiredString(source, 'message', 2000) };
}

export function digestUserMessage(facts: DigestFacts): string {
  const attention =
    facts.attention.length === 0
      ? 'nothing'
      : facts.attention.map((item) => `- ${item.title}: ${item.detail}`).join('\n');

  return [
    `Date: ${facts.date}`,
    `Vehicles on the road: ${facts.vehiclesOnRoad} of ${facts.vehiclesTotal}`,
    `Trips finished today: ${facts.tripsFinished}`,
    `Trips started today: ${facts.tripsStarted}`,
    `Revenue today: ${facts.revenueToday.toString()} tiyin`,
    `Expenses today: ${facts.expensesToday.toString()} tiyin`,
    `Profit today: ${facts.profitToday.toString()} tiyin`,
    `Loadings booked for tomorrow: ${facts.loadingsTomorrow}`,
    `Documents expiring within 7 days: ${facts.documentsExpiringSoon}`,
    'Needs attention:',
    attention,
  ].join('\n');
}
