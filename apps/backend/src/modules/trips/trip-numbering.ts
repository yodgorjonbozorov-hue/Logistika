import type { TenantScopedClient } from '../../prisma/prisma.service';

/**
 * Per-company, per-year trip numbers (TASK-3.7).
 *
 * The number used to be `count() + 1`. Two failures came with that:
 *
 *  - it repeats. Remove a trip and the next one takes the number that just
 *    became free, so two different trips end up carrying the same number in
 *    the paperwork the number exists for;
 *  - it races. Two creates in the same second read the same count and ask for
 *    the same number. A retry loop tried three times and then handed the raw
 *    unique-constraint error to the user.
 *
 * A counter row that is incremented instead of counted has neither problem.
 * The increment locks the row until the surrounding transaction commits, so a
 * second creator queues behind it and takes the following number.
 *
 * Gaps are accepted: a transaction that took a number and then failed leaves
 * one unused. A gap is a number nobody used; a repeat is two trips claiming to
 * be the same one, and only the second is a problem worth solving.
 */

const SEQUENCE_DIGITS = 4;

/** `TR-2026-0042` — self-describing in a document, sortable inside a year. */
export function formatTripNumber(year: number, sequence: number): string {
  return `TR-${year}-${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`;
}

/**
 * Takes the next number for this company and year.
 *
 * Must be called inside a transaction: the lock the increment takes is what
 * makes two simultaneous creates line up, and it is released at commit.
 */
export async function nextTripNumber(
  tx: TenantScopedClient,
  companyId: string,
  now: Date = new Date(),
): Promise<string> {
  // UTC, like every other stored time: the year a trip belongs to must not
  // depend on which timezone the server happens to run in.
  const year = now.getUTCFullYear();

  const counter = await tx.tripCounter.upsert({
    where: { companyId_year: { companyId, year } },
    update: { lastNumber: { increment: 1 } },
    create: { companyId, year, lastNumber: 1 },
  });

  return formatTripNumber(year, counter.lastNumber);
}
