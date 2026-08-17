import type { Trip } from '@prisma/client';
import type { TenantActor } from 'shared';
import type { TenantScopedClient } from '../../prisma/prisma.service';
import type { CurrencyService } from '../currency/currency.service';
import type { LedgerService } from './ledger.service';

/**
 * Invoices a completed trip, once.
 *
 * A trip can reach COMPLETED from two directions — the logist pressing
 * complete, or the driver's FINISH event — and both must produce exactly one
 * TRIP_INVOICED entry. The existing-entry check is what makes that true even
 * if the two race or a retry replays.
 */
export async function invoiceCompletedTrip(
  ledger: LedgerService,
  currency: CurrencyService,
  tx: TenantScopedClient,
  actor: TenantActor,
  trip: Pick<Trip, 'id' | 'clientId' | 'agreedPrice' | 'currency' | 'tripNumber'>,
): Promise<void> {
  // Nothing to invoice: an internal run, or a trip with no agreed price yet.
  if (!trip.clientId || trip.agreedPrice <= 0n) return;

  const existing = await tx.ledgerEntry.findFirst({
    where: { tripId: trip.id, reason: 'TRIP_INVOICED' },
  });
  if (existing) return;

  const converted = await currency.toBase(trip.agreedPrice, trip.currency);

  await ledger.record(tx, actor, {
    clientId: trip.clientId,
    tripId: trip.id,
    direction: 'DEBIT',
    reason: 'TRIP_INVOICED',
    amount: trip.agreedPrice,
    currency: trip.currency,
    amountBase: converted.amountBase,
    reference: trip.tripNumber,
  });
}
