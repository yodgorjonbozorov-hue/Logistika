/**
 * The same batch, twice, is still one set of points (TASK-4.5, M-7).
 *
 * The phone marks a batch sent only after the server acknowledges it, so a
 * phone that dies in between sends it again. `GpsTrack` had nothing unique
 * about a point, so those coordinates landed twice: every distance total was
 * inflated and the drawn route stuttered over doubled vertices.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('GPS point idempotency (e2e)', () => {
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
    tenant = await createTenant(app, 'Gps');
    await request(app.getHttpServer())
      .post(`/api/v1/trips/${tenant.trip.id}/start`)
      .set(...bearer(tenant.tokens.owner))
      .send({})
      .expect(200);
  });

  const send = (positions: Array<Record<string, unknown>>) =>
    request(app.getHttpServer())
      .post('/api/v1/tracking/positions')
      .set(...bearer(tenant.tokens.driver))
      .send({ positions });

  /** Fixed instants, because the whole question is what happens on a repeat. */
  const at = (minute: number, lat = 41.3) => ({
    tripId: tenant.trip.id,
    lat,
    lng: 69.2,
    speed: 64,
    recordedAt: `2026-08-06T10:${String(minute).padStart(2, '0')}:00.000Z`,
  });

  const stored = () => prisma.gpsTrack.count({ where: { companyId: tenant.company.id } });

  it('stores a re-sent batch once', async () => {
    const batch = [at(1), at(2), at(3)];

    const first = await send(batch).expect(200);
    const second = await send(batch).expect(200);

    expect(await stored()).toBe(3);
    expect(first.body.data).toMatchObject({ accepted: 3, duplicates: 0 });
    // The honest answer to a repeat is "nothing new", not "three more points".
    expect(second.body.data).toMatchObject({ accepted: 0, duplicates: 3 });
  });

  it('accepts only the new part of an overlapping batch', async () => {
    await send([at(1), at(2)]).expect(200);

    const res = await send([at(2), at(3)]).expect(200);

    expect(res.body.data).toMatchObject({ accepted: 1, duplicates: 1 });
    expect(await stored()).toBe(3);
  });

  it('collapses a batch that repeats an instant within itself', async () => {
    const res = await send([at(1), at(1), at(2)]).expect(200);

    expect(await stored()).toBe(2);
    expect(res.body.data.accepted).toBe(2);
  });

  it('survives two flushes landing at the same moment', async () => {
    const batch = [at(1), at(2), at(3), at(4)];

    // A phone that wakes up with a full queue can genuinely have two flushes in
    // flight; a read-then-write would race through the gap between them.
    const [a, b] = await Promise.all([send(batch), send(batch)]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await stored()).toBe(4);
  });

  it('keeps the distance total honest across a re-send', async () => {
    // Two points a real distance apart; doubling them used to double the trip's
    // reported kilometres, which is money once a per-km salary is involved.
    const batch = [at(1, 41.0), at(2, 41.5)];
    await send(batch).expect(200);
    await send(batch).expect(200);

    const rows = await prisma.gpsTrack.findMany({
      where: { companyId: tenant.company.id },
      orderBy: { recordedAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.lat)).toEqual([41, 41.5]);
  });

  it('lets two companies report the same instant for their own vehicles', async () => {
    const other = await createTenant(app, 'GpsOther');
    await request(app.getHttpServer())
      .post(`/api/v1/trips/${other.trip.id}/start`)
      .set(...bearer(other.tokens.owner))
      .send({})
      .expect(200);

    await send([at(1)]).expect(200);
    // The key is scoped by company and vehicle: one fleet's clock must never
    // block another's.
    await request(app.getHttpServer())
      .post('/api/v1/tracking/positions')
      .set(...bearer(other.tokens.driver))
      .send({
        positions: [
          { tripId: other.trip.id, lat: 41.3, lng: 69.2, recordedAt: '2026-08-06T10:01:00.000Z' },
        ],
      })
      .expect(200);

    expect(await prisma.gpsTrack.count({ where: { companyId: other.company.id } })).toBe(1);
    expect(await stored()).toBe(1);
  });
});
