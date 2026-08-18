/**
 * Retiring a catalogue record (TASK-3.11).
 *
 * Clients were hard-deleted while drivers and vehicles were not. The foreign
 * keys made the delete fail once a trip or an income pointed at the client,
 * which hid the real problem: it *succeeded* for a client with nothing
 * attached, and that row vanished — the audit `before` was the only remaining
 * trace that the counterparty had existed.
 *
 * The other half is that retiring anything left it in every list and every
 * picker, so a driver who had left the company could still be put on
 * tomorrow's trip. A record that can still be assigned is a flag, not a soft
 * delete.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Soft delete (e2e)', () => {
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
    tenant = await createTenant(app, 'Archive');
  });

  const owner = () => `Bearer ${tenant.tokens.owner}`;
  const server = () => app.getHttpServer();

  const retire = (resource: string, id: string) =>
    request(server()).delete(`/api/v1/${resource}/${id}`).set('authorization', owner());

  const listOf = (resource: string, query = '') =>
    request(server())
      .get(`/api/v1/${resource}?limit=100${query}`)
      .set('authorization', owner())
      .expect(200);

  /** A spare client with nothing attached — the case the hard delete erased. */
  const spareClient = () =>
    prisma.client.create({ data: { companyId: tenant.company.id, name: 'Spare Mijoz' } });

  describe('a retired client', () => {
    it('keeps its row instead of being deleted', async () => {
      const client = await spareClient();

      await retire('clients', client.id).expect(200);

      const stored = await prisma.client.findUnique({ where: { id: client.id } });
      // The hard delete removed exactly this kind of client completely.
      expect(stored).not.toBeNull();
      expect(stored?.isActive).toBe(false);
      expect(stored?.name).toBe('Spare Mijoz');
    });

    it('leaves the working list but stays in the archive', async () => {
      const client = await spareClient();
      await retire('clients', client.id).expect(200);

      const active = await listOf('clients');
      expect(active.body.data.map((row: { id: string }) => row.id)).not.toContain(client.id);

      const archived = await listOf('clients', '&includeInactive=true');
      expect(archived.body.data.map((row: { id: string }) => row.id)).toContain(client.id);
    });

    it('cannot be put on a new trip', async () => {
      const client = await spareClient();
      await retire('clients', client.id).expect(200);

      const res = await request(server())
        .post('/api/v1/trips')
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ clientId: client.id, agreedPrice: '1000000' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESOURCE_IN_USE');
    });

    it('keeps its old trips and ledger entries readable', async () => {
      // The fixture client is attached to the fixture trip; settle it first.
      await request(server())
        .post(`/api/v1/trips/${tenant.trip.id}/cancel`)
        .set('authorization', owner())
        .expect(200);

      await retire('clients', tenant.client.id).expect(200);

      const trip = await request(server())
        .get(`/api/v1/trips/${tenant.trip.id}`)
        .set('authorization', owner())
        .expect(200);
      // The counterparty on a past trip is still named.
      expect(trip.body.data.client.name).toBe(tenant.client.name);
    });

    it('is refused while the client still owes money', async () => {
      await request(server())
        .post(`/api/v1/trips/${tenant.trip.id}/start`)
        .set('authorization', owner())
        .expect(200);
      await request(server())
        .post(`/api/v1/trips/${tenant.trip.id}/complete`)
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({})
        .expect(200);

      const res = await retire('clients', tenant.client.id);

      // Retiring a debtor takes the debt out of the list with them.
      expect(res.status).toBe(409);
      expect(res.body.error.details.reason).toBe('balance');
    });

    it('is refused while a trip for them is still planned', async () => {
      const res = await retire('clients', tenant.client.id);
      expect(res.status).toBe(409);
      expect(res.body.error.details.reason).toBe('trip');
    });
  });

  describe('retired drivers and vehicles', () => {
    const freeTheFixtureTrip = () =>
      request(server())
        .post(`/api/v1/trips/${tenant.trip.id}/cancel`)
        .set('authorization', owner())
        .expect(200);

    it('leave the pickers the logist chooses from', async () => {
      await freeTheFixtureTrip();
      await retire('drivers', tenant.driver.id).expect(200);
      await retire('vehicles', tenant.vehicle.id).expect(200);

      const drivers = await listOf('drivers');
      const vehicles = await listOf('vehicles');
      expect(drivers.body.data).toHaveLength(0);
      expect(vehicles.body.data).toHaveLength(0);
      // The count has to match the list, or the last page comes back empty.
      expect(drivers.body.meta.pagination.total).toBe(0);
    });

    it('cannot be assigned to a trip afterwards', async () => {
      await freeTheFixtureTrip();
      await retire('drivers', tenant.driver.id).expect(200);

      const created = await request(server())
        .post('/api/v1/trips')
        .set('authorization', owner())
        .set('idempotency-key', randomUUID())
        .send({ agreedPrice: '1000000' })
        .expect(201);

      const res = await request(server())
        .post(`/api/v1/trips/${created.body.data.id}/assign`)
        .set('authorization', owner())
        .send({ driverId: tenant.driver.id, vehicleId: tenant.vehicle.id });

      // Otherwise TASK-3.10's mid-route guard is undone by anyone picking the
      // driver out of a stale list.
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESOURCE_IN_USE');
    });

    it('are still visible in the archive', async () => {
      await freeTheFixtureTrip();
      await retire('drivers', tenant.driver.id).expect(200);

      const archived = await listOf('drivers', '&includeInactive=true');
      expect(archived.body.data.map((row: { id: string }) => row.id)).toContain(tenant.driver.id);
    });
  });

  it('never shows another tenant its neighbour’s archive', async () => {
    const other = await createTenant(app, 'Neighbour');
    const theirClient = await prisma.client.create({
      data: { companyId: other.company.id, name: 'Their Client', isActive: false },
    });

    const archived = await listOf('clients', '&includeInactive=true');

    expect(archived.body.data.map((row: { id: string }) => row.id)).not.toContain(theirClient.id);
  });
});
