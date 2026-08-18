import { ApiError } from './client';

/**
 * Turns the server's validation reply into per-field messages (TASK-5.3).
 *
 * `ValidationPipe` sends `details` as a flat `string[]`, each entry starting
 * with the property it is about: `"amount must be a tiyin amount (digits
 * only)"`. Rendering that array as one paragraph made the user hunt for which
 * box was wrong; the field itself is where the answer belongs.
 *
 * The parse is deliberately conservative. Anything whose first word is not a
 * plausible property name stays in `general`, because a message shown under the
 * wrong field is worse than one shown at the top.
 */
export interface FieldErrors {
  /** Keyed by property name, in the order the server listed them. */
  fields: Record<string, string[]>;
  /** Everything that could not be attributed to a field. */
  general: string[];
}

const PROPERTY = /^([a-z][A-Za-z0-9]*)\s+(.+)$/;

export function fieldErrors(error: unknown): FieldErrors {
  const empty: FieldErrors = { fields: {}, general: [] };
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return empty;

  for (const entry of error.details) {
    if (typeof entry !== 'string') continue;
    const match = PROPERTY.exec(entry);
    if (match) {
      const [, property, rest] = match;
      (empty.fields[property!] ??= []).push(rest!);
    } else {
      empty.general.push(entry);
    }
  }
  return empty;
}

/** The first message for a field, or undefined — what a form control needs. */
export const errorFor = (errors: FieldErrors, field: string): string | undefined =>
  errors.fields[field]?.[0];
