/**
 * Pagination actually paginates (TASK-4.2).
 *
 * `skip` used to be a `get skip()` accessor on PaginationDto, and every list
 * DTO built with `IntersectionType(PaginationDto, DateRangeDto)` — trips,
 * events, ledger, audit logs — silently lost it, because mapped-types rebuild
 * a class from its own properties and a prototype accessor is not one. Prisma
 * ignores an undefined `skip`, so `?page=2` served page 1 again, with a total
 * that looked perfectly right. Nothing ever threw. These tests read the second
 * page and insist it is a different second page.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bearer, createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Pagination (e2e)', () => {
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
    tenant = await createTenant(app, 'Page');
  });

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set(...bearer(tenant.tokens.owner));

  /** The fixture already made one trip; this brings the company up to five. */
  async function seedTrips(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      await prisma.trip.create({
        data: {
          companyId: tenant.company.id,
          tripNumber: `TR-PAGE-${i}-${randomUUID().slice(0, 6)}`,
          clientId: tenant.client.id,
          vehicleId: tenant.vehicle.id,
          driverId: tenant.driver.id,
          status: 'ASSIGNED',
        },
      });
    }
  }

  const idsOf = (body: { data: Array<{ id: string }> }) => body.data.map((row) => row.id);

  it('serves a different second page', async () => {
    await seedTrips();

    const first = await get('/trips?page=1&limit=2');
    const second = await get('/trips?page=2&limit=2');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(idsOf(first.body)).toHaveLength(2);
    expect(idsOf(second.body)).toHaveLength(2);
    // The whole bug in one assertion: these used to be the same two rows.
    expect(idsOf(second.body)).not.toEqual(idsOf(first.body));
    expect(idsOf(first.body).some((id) => idsOf(second.body).includes(id))).toBe(false);
  });

  it('walks the whole list without repeating or losing a row', async () => {
    await seedTrips();

    const pages = await Promise.all([1, 2, 3].map((page) => get(`/trips?page=${page}&limit=2`)));
    const seen = pages.flatMap((res) => idsOf(res.body));

    expect(new Set(seen).size).toBe(5);
    expect(pages[2]!.body.meta.pagination.hasMore).toBe(false);
  });

  it('reports hasMore from the page beyond, and the total when asked', async () => {
    await seedTrips();

    const res = await get('/trips?page=1&limit=2');

    expect(res.body.meta.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: 5,
      hasMore: true,
    });
  });

  it('skips the count when the caller does not want it', async () => {
    await seedTrips();

    const res = await get('/trips?page=1&limit=2&withTotal=false');

    // A picker never renders "1–2 of 5", so the count is pure cost — but
    // "is there more" still has to be right, and it comes from the extra row.
    expect(res.body.meta.pagination.total).toBeNull();
    expect(res.body.meta.pagination.hasMore).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  it('paginates the ledger past the first page', async () => {
    for (let i = 0; i < 3; i += 1) {
      await prisma.ledgerEntry.create({
        data: {
          companyId: tenant.company.id,
          clientId: tenant.client.id,
          direction: 'DEBIT',
          reason: 'TRIP_INVOICED',
          amount: BigInt(1_000 + i),
          amountBase: BigInt(1_000 + i),
          createdById: tenant.owner.id,
        },
      });
    }

    const first = await get(`/clients/${tenant.client.id}/ledger?page=1&limit=2`);
    const second = await get(`/clients/${tenant.client.id}/ledger?page=2&limit=2`);

    expect(idsOf(first.body)).toHaveLength(2);
    expect(idsOf(second.body)).toHaveLength(1);
    expect(idsOf(first.body)).not.toContain(idsOf(second.body)[0]);
  });

  it("never lets one company page into another one's trips", async () => {
    await seedTrips();
    const other = await createTenant(app, 'Other');

    const res = await request(app.getHttpServer())
      .get('/api/v1/trips?page=1&limit=100')
      .set(...bearer(other.tokens.owner));

    expect(res.status).toBe(200);
    // Only their own single fixture trip, no matter how wide the page is.
    expect(idsOf(res.body)).toEqual([other.trip.id]);
  });
});
