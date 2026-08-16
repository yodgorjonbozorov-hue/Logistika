import { Currency, ExpenseCategory } from 'shared';
import { toScaledInt } from '../../common/money';
import type { AiToolSpec } from './ai.client';
import {
  asObject,
  confidenceBp,
  optionalDate,
  optionalEnum,
  optionalNumber,
  optionalString,
  requiredEnum,
} from './ai.validation';

/** Documents drivers and accountants photograph (TZ §8.3). */
export const OCR_DOC_TYPES = [
  'fuel_receipt',
  'waybill',
  'cmr',
  'customs',
  'repair',
  'fine',
  'odometer',
  'other',
] as const;
export type OcrDocType = (typeof OCR_DOC_TYPES)[number];

const CURRENCIES = Object.values(Currency) as readonly string[];

/**
 * The model never decides what a paper *means* for the books — it only reports
 * what is printed on it. Amounts come back in so'm (what the receipt shows) and
 * are converted to tiyin here, in code.
 */
export const OCR_SYSTEM_PROMPT = [
  'You read photographed logistics documents for an Uzbek trucking company.',
  'Documents are in Uzbek (Latin or Cyrillic) or Russian; numbers may use spaces',
  'as thousands separators and a comma as the decimal mark.',
  '',
  'Report only what is actually printed on the document. Leave a field null when',
  'it is absent, unreadable or you would have to guess — never invent a value and',
  'never compute a field from other fields.',
  '',
  "Amounts are in the currency printed on the document, in whole units (so'm,",
  'not tiyin). Dates are ISO 8601; include the time only when the document shows it.',
  'Set confidence to how sure you are of the whole reading: 1.0 for a sharp,',
  'fully legible document, below 0.7 when the photo is blurred, cropped or dark.',
].join('\n');

export const OCR_TOOL: AiToolSpec = {
  name: 'report_document',
  description: 'Report the fields printed on the photographed document.',
  schema: {
    type: 'object',
    properties: {
      doc_type: {
        type: 'string',
        enum: [...OCR_DOC_TYPES],
        description: 'What the document is.',
      },
      date: { type: 'string', description: 'Date (and time, if shown) on the document, ISO 8601.' },
      currency: { type: 'string', enum: [...CURRENCIES] },
      total_amount: { type: 'number', description: 'Total sum printed, in whole currency units.' },
      liters: { type: 'number', description: 'Litres dispensed (fuel receipts).' },
      price_per_liter: { type: 'number', description: 'Price of one litre.' },
      vendor: { type: 'string', description: 'Filling station, workshop or issuing office name.' },
      location: { type: 'string', description: 'City or address printed on the document.' },
      odometer: { type: 'number', description: 'Odometer reading (odometer photos).' },
      document_number: { type: 'string' },
      cargo_name: { type: 'string', description: 'Cargo description (waybill, CMR).' },
      cargo_weight_kg: { type: 'number' },
      sender: { type: 'string' },
      receiver: { type: 'string' },
      reason: { type: 'string', description: 'Reason stated on a fine or customs charge.' },
      comment: { type: 'string', description: 'Anything else worth showing the user.' },
      confidence: { type: 'number', description: '0.0–1.0 confidence in this reading.' },
    },
    required: ['doc_type', 'confidence'],
  },
};

/** What OCR proposes — money in tiyin, litres in centilitres, nothing stored yet. */
export interface OcrFields {
  docType: OcrDocType;
  date: Date | null;
  currency: Currency;
  totalAmount: bigint | null;
  litersCl: bigint | null;
  pricePerLiter: bigint | null;
  vendor: string | null;
  location: string | null;
  odometer: number | null;
  documentNumber: string | null;
  cargoName: string | null;
  cargoWeightKg: number | null;
  sender: string | null;
  receiver: string | null;
  reason: string | null;
  comment: string | null;
  confidenceBp: number | null;
  /** Category the fields suggest; the person confirming can change it. */
  suggestedCategory: ExpenseCategory | null;
}

/** so'm → tiyin. Amounts on a receipt stay far inside the exact integer range. */
function toTiyin(source: Record<string, unknown>, field: string): bigint | null {
  const value = optionalNumber(source, field, 1e15);
  return value === null ? null : toScaledInt(String(value), 2);
}

const CATEGORY_BY_DOC: Partial<Record<OcrDocType, ExpenseCategory>> = {
  fuel_receipt: ExpenseCategory.FUEL,
  customs: ExpenseCategory.CUSTOMS,
  repair: ExpenseCategory.REPAIR,
  fine: ExpenseCategory.FINE,
};

/**
 * Validates the model answer field by field (CLAUDE.md: AI JSON is external
 * input) and converts it into the units the rest of the system uses.
 */
export function parseOcr(raw: unknown): OcrFields {
  const source = asObject(raw);
  const docType = requiredEnum(source, 'doc_type', OCR_DOC_TYPES);
  const liters = optionalNumber(source, 'liters', 100_000);

  return {
    docType,
    date: optionalDate(source, 'date'),
    currency: (optionalEnum(source, 'currency', CURRENCIES) as Currency) ?? Currency.UZS,
    totalAmount: toTiyin(source, 'total_amount'),
    litersCl: liters === null ? null : toScaledInt(String(liters), 2),
    pricePerLiter: toTiyin(source, 'price_per_liter'),
    vendor: optionalString(source, 'vendor', 200),
    location: optionalString(source, 'location', 200),
    odometer: optionalNumber(source, 'odometer', 10_000_000),
    documentNumber: optionalString(source, 'document_number', 100),
    cargoName: optionalString(source, 'cargo_name', 200),
    cargoWeightKg: optionalNumber(source, 'cargo_weight_kg', 200_000),
    sender: optionalString(source, 'sender', 200),
    receiver: optionalString(source, 'receiver', 200),
    reason: optionalString(source, 'reason', 500),
    comment: optionalString(source, 'comment', 1000),
    confidenceBp: confidenceBp(source),
    suggestedCategory: CATEGORY_BY_DOC[docType] ?? null,
  };
}
