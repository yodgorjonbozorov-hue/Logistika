/**
 * Offline-sync idempotency under concurrency (TASK-3.8).
 *
 * Every driver event carries a client-generated UUID so a phone that lost the
 * network can resend without creating the event twice. The check for "have I
 * seen this id" was a findMany followed by a create — two batches arriving
 * together both read "not seen" and both wrote.
 *
 * The unique index caught the second write, but nothing caught the error it
 * raised, so the whole batch failed with a 500 — and the app, doing exactly
 * what it should, resent the same batch forever.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Event batch idempotency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TenantFixture;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    tenant = await createTenant(app, 'Sync');
  });

  const batch = (events: Array<Record<string, unknown>>, token = tenant.tokens.driver) =>
    request(app.getHttpServer())
      .post('/api/v1/events/batch')
      .set('authorization', `Bearer ${token}`)
      .send({ events });

  const event = (extra: Record<string, unknown> = {}) => ({
    clientEventId: randomUUID(),
    tripId: tenant.trip.id,
    eventType: 'REFUEL',
    eventTime: new Date().toISOString(),
    ...extra,
  });

  const rowsFor = (clientEventId: string) => prisma.tripEvent.count({ where: { clientEventId } });

  it('stores one row when the same event arrives in two parallel batches', async () => {
    const one = event({ comment: 'Yoqilgi quydim' });

    const [a, b] = await Promise.all([batch([one]), batch([one])]);

    // Neither request may fail: a duplicate is a normal outcome of a retry,
    // not an error the driver has to see.
    expect([a.status, b.status]).toEqual([200, 200]);

    const outcomes = [a, b].map((res) =>
      (res.body.data.accepted as string[]).includes(one.clientEventId) ? 'accepted' : 'duplicate',
    );
    expect(outcomes.sort()).toEqual(['accepted', 'duplicate']);

    const loser = a.body.data.accepted.length === 0 ? a : b;
    expect(loser.body.data.duplicates).toEqual([one.clientEventId]);
    expect(loser.body.data.rejected).toEqual([]);

    expect(await rowsFor(one.clientEventId)).toBe(1);
  });

  it('applies the trip transition exactly once under the same race', async () => {
    const start = event({ eventType: 'START', odometer: 411_500 });

    const [a, b] = await Promise.all([batch([start]), batch([start])]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await rowsFor(start.clientEventId)).toBe(1);

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tenant.trip.id } });
    expect(trip.status).toBe('IN_PROGRESS');
    // One event, one transition. Two would have re-stamped startedAt.
    expect(trip.version).toBe(1);
  });

  it('lets the rest of a batch through when one event is a duplicate', async () => {
    const seen = event({ comment: 'birinchi' });
    await batch([seen]).expect(200);

    const fresh = event({ comment: 'ikkinchi' });
    const res = await batch([seen, fresh]).expect(200);

    expect(res.body.data.duplicates).toEqual([seen.clientEventId]);
    expect(res.body.data.accepted).toEqual([fresh.clientEventId]);
    expect(res.body.data.rejected).toEqual([]);
    expect(await rowsFor(fresh.clientEventId)).toBe(1);
  });

  it('keeps ten parallel resends of one event down to one row', async () => {
    // What a phone actually does after a long tunnel: the queue flushes, the
    // connectivity listener fires, and several flushes overlap.
    const one = event();

    const responses = await Promise.all(Array.from({ length: 10 }, () => batch([one])));

    expect(responses.every((res) => res.status === 200)).toBe(true);
    const accepted = responses.filter((res) => res.body.data.accepted.length === 1);
    expect(accepted).toHaveLength(1);
    expect(await rowsFor(one.clientEventId)).toBe(1);
  });

  it('lets two companies use the same client id without colliding', async () => {
    const other = await createTenant(app, 'Other');
    const sharedId = randomUUID();

    await batch([event({ clientEventId: sharedId })]).expect(200);
    const theirs = await batch(
      [
        {
          clientEventId: sharedId,
          tripId: other.trip.id,
          eventType: 'REFUEL',
          eventTime: new Date().toISOString(),
        },
      ],
      other.tokens.driver,
    ).expect(200);

    // The id is unique per tenant, not globally: one company's ids must never
    // decide what another company is allowed to store.
    expect(theirs.body.data.accepted).toEqual([sharedId]);
    expect(await rowsFor(sharedId)).toBe(2);
  });
});
