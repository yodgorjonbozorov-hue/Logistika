/**
 * The anti-hallucination guard.
 *
 * A language model asked to describe a company's finances will, occasionally
 * and very fluently, produce a number that was not in its input. In a logistics
 * P&L that is worse than no answer at all — the operator has no way to tell the
 * invented figure from the real one, and it looks exactly as authoritative.
 *
 * So every figure in the model's answer is checked against the fact sheet it
 * was given. An answer containing a number nobody computed is discarded and the
 * deterministic answer is sent instead. The user still gets a reply; it is just
 * one that is guaranteed to come from the database.
 *
 * What is allowed beyond the facts themselves:
 *  - names from the fact sheet, removed before anything is parsed: a plate like
 *    `01D777DD` and a route called `M39 lane` carry digits that are part of an
 *    identifier, not a figure,
 *  - numbers the user typed in their own question ("oxirgi 30 kun"),
 *  - the year and month numbers of the period under discussion,
 *  - integers 0–31, which cover counts, ordinals, day-of-month and "top 5"
 *    style phrasing and cannot misrepresent a sum of money.
 */
import { canonicalNumber, type FactSheet } from './facts';

export interface VerificationResult {
  ok: boolean;
  /** The figures that could not be traced to a fact. */
  unknown: string[];
}

/** Numbers small enough that they cannot be a fabricated financial figure. */
const SAFE_MAX_INTEGER = 31;

/**
 * A number as it appears in prose.
 *
 * A separator only continues the token when a digit follows it IMMEDIATELY.
 * Allowing whitespace or a full stop to be followed by anything let a sentence
 * boundary glue two numbers into one: "…2026-07-31. 2026-07: daromad…" parsed
 * as the single figure `-31.2026`, which is in no fact sheet, and a perfectly
 * correct answer was discarded for it. Found on a staging deployment.
 */
const NUMBER_TOKEN = /-?\d(?:[\u00A0 ](?=\d)|[.,](?=\d)|\d)*/g;

/** Removes every known name from the text so its digits are never parsed. */
function stripNames(text: string, names: string[]): string {
  // Longest first, so "01D777DD" is removed before a shorter name that happens
  // to be a prefix of it.
  return [...names]
    .sort((a, b) => b.length - a.length)
    .reduce((stripped, name) => (name ? stripped.split(name).join(' ') : stripped), text);
}

export function verifyAnswer(
  answer: string,
  sheet: FactSheet,
  question: string,
  period: { from: Date; to: Date },
): VerificationResult {
  const allowed = new Set(sheet.allowedNumbers);
  const text = stripNames(answer, sheet.textValues);

  for (const token of question.match(NUMBER_TOKEN) ?? []) {
    const canonical = canonicalNumber(token);
    if (canonical) allowed.add(canonical);
  }
  for (const date of [period.from, period.to]) {
    allowed.add(String(date.getUTCFullYear()));
    allowed.add(String(date.getUTCMonth() + 1));
    allowed.add(String(date.getUTCDate()));
  }

  const unknown: string[] = [];
  for (const token of text.match(NUMBER_TOKEN) ?? []) {
    const canonical = canonicalNumber(token);
    if (!canonical) continue;
    if (allowed.has(canonical)) continue;

    const asNumber = Number(canonical);
    if (Number.isInteger(asNumber) && Math.abs(asNumber) <= SAFE_MAX_INTEGER) continue;

    unknown.push(canonical);
  }

  return { ok: unknown.length === 0, unknown };
}
