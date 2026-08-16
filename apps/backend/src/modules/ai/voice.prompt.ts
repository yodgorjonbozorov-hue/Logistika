import { Currency, ExpenseCategory, TripEventType } from 'shared';
import { toScaledInt } from '../../common/money';
import type { AiToolSpec } from './ai.client';
import {
  asObject,
  confidenceBp,
  optionalEnum,
  optionalNumber,
  optionalString,
  requiredEnum,
} from './ai.validation';

/** What a driver can report by voice (TZ §8.2). */
export const VOICE_EVENT_TYPES = [
  'refuel',
  'expense',
  'breakdown',
  'rest',
  'delivered',
  'other',
] as const;
export type VoiceEventType = (typeof VOICE_EVENT_TYPES)[number];

export const VOICE_CATEGORIES = [
  'fuel',
  'toll',
  'customs',
  'repair',
  'fine',
  'parking',
  'other',
] as const;
export type VoiceCategory = (typeof VOICE_CATEGORIES)[number];

const CURRENCIES = Object.values(Currency) as readonly string[];

/** Below this the app asks again instead of filling anything in (TZ §8.2). */
export const MIN_VOICE_CONFIDENCE_BP = 7000;

/**
 * The extraction rules of TZ §8.2, kept close to the wording of the spec: a
 * field that was not said stays null, and the model never fills a gap.
 */
export const VOICE_SYSTEM_PROMPT = [
  'You extract structured data from what a truck driver just said while driving.',
  'They speak Uzbek (Latin or Cyrillic) or Russian, in short unpolished phrases,',
  'and numbers are often spoken in words ("uch yuz litr" = 300 litres).',
  '',
  'Leave a field null when it was not said or you are unsure — never guess, and',
  'never derive one field from another.',
  'Amounts are in whole currency units, the way they were spoken.',
  'Set confidence to how sure you are of the whole reading: below 0.7 when the',
  'recording is unclear, cut off, or you had to interpret rather than hear.',
].join('\n');

export const VOICE_TOOL: AiToolSpec = {
  name: 'report_voice_entry',
  description: 'Report what the driver said, as structured fields.',
  schema: {
    type: 'object',
    properties: {
      event_type: { type: 'string', enum: [...VOICE_EVENT_TYPES] },
      liters: { type: 'number', description: 'Litres, for a refuel.' },
      amount: { type: 'number', description: 'Sum spoken, in whole currency units.' },
      currency: { type: 'string', enum: [...CURRENCIES] },
      location: { type: 'string', description: 'Place named, if any.' },
      category: { type: 'string', enum: [...VOICE_CATEGORIES] },
      comment: { type: 'string', description: 'Everything else, in their own words.' },
      confidence: { type: 'number', description: '0.0–1.0 confidence in this reading.' },
    },
    required: ['event_type', 'confidence'],
  },
};

export interface VoiceEntry {
  eventType: VoiceEventType;
  /** The trip event this maps to, when it maps to one at all. */
  suggestedEvent: TripEventType | null;
  litersCl: bigint | null;
  amount: bigint | null;
  currency: Currency;
  location: string | null;
  category: VoiceCategory | null;
  suggestedCategory: ExpenseCategory | null;
  comment: string | null;
  confidenceBp: number | null;
}

const EVENT_BY_TYPE: Partial<Record<VoiceEventType, TripEventType>> = {
  refuel: TripEventType.REFUEL,
  expense: TripEventType.EXPENSE,
  breakdown: TripEventType.BREAKDOWN,
  rest: TripEventType.REST,
  delivered: TripEventType.DELIVERED,
};

const CATEGORY_BY_NAME: Record<VoiceCategory, ExpenseCategory> = {
  fuel: ExpenseCategory.FUEL,
  toll: ExpenseCategory.TOLL,
  customs: ExpenseCategory.CUSTOMS,
  repair: ExpenseCategory.REPAIR,
  fine: ExpenseCategory.FINE,
  parking: ExpenseCategory.PARKING,
  other: ExpenseCategory.OTHER,
};

/** Validates the model answer and converts it into the units the system uses. */
export function parseVoice(raw: unknown): VoiceEntry {
  const source = asObject(raw);
  const eventType = requiredEnum(source, 'event_type', VOICE_EVENT_TYPES);
  const liters = optionalNumber(source, 'liters', 100_000);
  const amount = optionalNumber(source, 'amount', 1e15);
  const category = optionalEnum(source, 'category', VOICE_CATEGORIES);

  return {
    eventType,
    suggestedEvent: EVENT_BY_TYPE[eventType] ?? null,
    litersCl: liters === null ? null : toScaledInt(String(liters), 2),
    amount: amount === null ? null : toScaledInt(String(amount), 2),
    currency: (optionalEnum(source, 'currency', CURRENCIES) as Currency) ?? Currency.UZS,
    location: optionalString(source, 'location', 200),
    category,
    suggestedCategory: category ? CATEGORY_BY_NAME[category] : null,
    comment: optionalString(source, 'comment', 1000),
    confidenceBp: confidenceBp(source),
  };
}
