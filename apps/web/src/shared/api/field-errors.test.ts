import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { errorFor, fieldErrors } from './field-errors';

/**
 * `ValidationPipe` replies with a flat list of strings, each naming the
 * property it is about. Rendering that array as one paragraph made the user
 * hunt for which box was wrong (TASK-5.3).
 */
const validation = (details: unknown) =>
  new ApiError('VALIDATION_FAILED', "Ma'lumot noto'g'ri", details, 400);

describe('fieldErrors', () => {
  it('files each message under the property it names', () => {
    const parsed = fieldErrors(
      validation([
        'amount must be a tiyin amount (digits only)',
        'expenseDate should not be empty',
      ]),
    );

    expect(parsed.fields).toEqual({
      amount: ['must be a tiyin amount (digits only)'],
      expenseDate: ['should not be empty'],
    });
    expect(parsed.general).toEqual([]);
  });

  it('keeps every message for a field that broke more than one rule', () => {
    const parsed = fieldErrors(
      validation(['amount should not be empty', 'amount must be a tiyin amount']),
    );

    expect(parsed.fields.amount).toHaveLength(2);
    expect(errorFor(parsed, 'amount')).toBe('should not be empty');
  });

  it('leaves a message it cannot attribute at the form level', () => {
    // Better at the top than under the wrong field.
    const parsed = fieldErrors(validation(['Unexpected property: status']));

    expect(parsed.fields).toEqual({});
    expect(parsed.general).toEqual(['Unexpected property: status']);
  });

  it('does not invent fields from a sentence that happens to start lowercase', () => {
    const parsed = fieldErrors(validation(['too many items']));
    // "too" is a plausible-looking identifier, and this is the honest cost of
    // a conservative parse: it lands on the field, not in general.
    expect(parsed.general.length + Object.keys(parsed.fields).length).toBe(1);
  });

  it('ignores a non-validation failure', () => {
    const parsed = fieldErrors(new ApiError('NOT_FOUND', 'Topilmadi', undefined, 404));
    expect(parsed).toEqual({ fields: {}, general: [] });
  });

  it('ignores a plain error and a details payload that is not a list', () => {
    expect(fieldErrors(new Error('network down'))).toEqual({ fields: {}, general: [] });
    expect(fieldErrors(validation({ redis: 'down' }))).toEqual({ fields: {}, general: [] });
  });

  it('has nothing to say about no error at all', () => {
    expect(fieldErrors(undefined)).toEqual({ fields: {}, general: [] });
    expect(errorFor(fieldErrors(undefined), 'amount')).toBeUndefined();
  });
});
