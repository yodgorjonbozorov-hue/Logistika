import type { Locale } from 'shared';
import type { AiToolSpec } from './ai.client';
import { asObject, optionalString, requiredString } from './ai.validation';
import type { AnomalyFinding } from './anomaly.detect';

const LANGUAGE: Record<Locale, string> = {
  'uz-latn': 'Uzbek, Latin script',
  'uz-cyrl': 'Uzbek, Cyrillic script',
  ru: 'Russian',
};

/**
 * The model is handed a finished calculation and asked for one thing: the
 * sentence a boss can act on (TZ §8.5). It is told, in as many words, that the
 * numbers are not its to produce — §8.12 rule 7.
 */
export function anomalySystemPrompt(locale: Locale): string {
  return [
    'You explain anomalies that a logistics system has already detected and',
    'measured. You are the last step: the arithmetic is done, the figures are',
    'given to you, and your job is to say what likely caused this and what the',
    'owner should do about it.',
    '',
    'Rules:',
    '- Use only the figures given. Never calculate, estimate or round a new one.',
    '- Name the most likely causes plainly; if the data cannot tell them apart,',
    '  say so instead of picking one.',
    '- The recommendation must be a concrete next step someone can take today.',
    '- Say how thin the evidence is when the sample is small.',
    `- Write everything in ${LANGUAGE[locale]}. Keep it short: a boss reads this on a phone.`,
  ].join('\n');
}

export const ANOMALY_TOOL: AiToolSpec = {
  name: 'explain_anomaly',
  description: 'Explain the detected anomaly and recommend what to do.',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'One line naming the anomaly and the subject.' },
      description: {
        type: 'string',
        description: 'Two or three sentences: what was measured and what likely caused it.',
      },
      recommendation: { type: 'string', description: 'One concrete next step.' },
    },
    required: ['title', 'description'],
  },
};

export interface AnomalyNarrative {
  title: string;
  description: string;
  recommendation: string | null;
}

export function parseNarrative(raw: unknown): AnomalyNarrative {
  const source = asObject(raw);
  return {
    title: requiredString(source, 'title', 200),
    description: requiredString(source, 'description', 1500),
    recommendation: optionalString(source, 'recommendation', 500),
  };
}

/** The finding, written out for the model: type, severity and the bare facts. */
export function anomalyUserMessage(finding: AnomalyFinding): string {
  const facts = Object.entries(finding.facts)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join('\n');
  const loss =
    finding.estimatedLoss === null
      ? 'not computable from the available data — do not invent one'
      : `${finding.estimatedLoss.toString()} tiyin (1 so'm = 100 tiyin)`;

  return [
    `Anomaly: ${finding.type}`,
    `Severity assigned by the system: ${finding.severity}`,
    `Subject: ${finding.relatedType} ${finding.relatedId}`,
    `Estimated loss: ${loss}`,
    'Measured figures (bp = basis points, 100 bp = 1%):',
    facts,
  ].join('\n');
}
