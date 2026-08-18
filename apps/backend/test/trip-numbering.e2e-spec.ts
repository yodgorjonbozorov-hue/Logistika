/**
 * Trip numbering (TASK-3.7).
 *
 * The number came from `count() + 1`, which fails two ways that only show up
 * against a real database: it repeats after a trip is removed, and two creates
 * in the same moment read the same count. The retry loop wrapped around it gave
 * up after three collisions and handed the raw unique-constraint error out.
 *
 * The parallel test below is the one that matters — a sequential test passes
 * against the broken code.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Trip numbering (e2e)', () => {
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
    tenant = await createTenant(app, 'Numbering');
  });

  const createTrip = (token = tenant.tokens.owner) =>
    request(app.getHttpServer())
      .post('/api/v1/trips')
      .set('authorization', `Bearer ${token}`)
      .set('idempotency-key', randomUUID())
      .send({ agreedPrice: '1000000' });

  it('gives ten simultaneous creates ten different numbers', async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => createTrip()));

    expect(responses.every((res) => res.status === 201)).toBe(true);

    const numbers = responses.map((res) => res.body.data.tripNumber as string);
    // The whole point: ten creates, ten numbers, no duplicate and no failure.
    expect(new Set(numbers).size).toBe(10);

    const counter = await prisma.tripCounter.findFirstOrThrow({
      where: { companyId: tenant.company.id },
    });
    expect(counter.lastNumber).toBeGreaterThanOrEqual(10);
  });

  it('does not reuse a number after a trip is removed', async () => {
    const first = await createTrip().expect(201);
    const firstNumber = first.body.data.tripNumber as string;

    // A trip is not deletable through the API; this is the seed script, an
    // import job or a manual cleanup during an incident.
    await prisma.trip.delete({ where: { id: first.body.data.id as string } });

    const second = await createTrip().expect(201);
    // count() + 1 handed the freed number straight back, so two trips carried
    // the same number in the paperwork the number exists for.
    expect(second.body.data.tripNumber).not.toBe(firstNumber);
  });

  it('numbers each company from its own sequence', async () => {
    const other = await createTenant(app, 'Other');

    const mine = await createTrip().expect(201);
    const theirs = await createTrip(other.tokens.owner).expect(201);

    // Both are the company's first trip of the year, so both are 0001 — the
    // sequence belongs to the tenant, not to the table.
    expect(mine.body.data.tripNumber).toMatch(/-0001$/);
    expect(theirs.body.data.tripNumber).toMatch(/-0001$/);

    const counters = await prisma.tripCounter.findMany({ orderBy: { companyId: 'asc' } });
    expect(counters).toHaveLength(2);
    expect(counters.every((row) => row.lastNumber === 1)).toBe(true);
  });

  it('carries the year and pads the sequence', async () => {
    const year = new Date().getUTCFullYear();
    const res = await createTrip().expect(201);

    expect(res.body.data.tripNumber).toBe(`TR-${year}-0001`);
  });

  it('keeps counting from where it left off', async () => {
    for (let i = 0; i < 3; i++) await createTrip().expect(201);

    const last = await createTrip().expect(201);
    expect(last.body.data.tripNumber).toMatch(/-0004$/);
  });

  it('hides another tenant’s counter behind the tenant scope', async () => {
    const other = await createTenant(app, 'Hidden');
    await createTrip(other.tokens.owner).expect(201);

    const visible = await prisma.forCompany(tenant.company.id).tripCounter.findMany({ where: {} });

    // The counter says how many trips a company runs — exactly the number a
    // competitor would want.
    expect(visible.every((row) => row.companyId === tenant.company.id)).toBe(true);
    expect(visible.some((row) => row.companyId === other.company.id)).toBe(false);
  });
});
