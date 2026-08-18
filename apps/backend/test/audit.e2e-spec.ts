/**
 * Audit completeness (TASK-2.9).
 *
 * Salary values live on drivers and balances on clients, yet those services
 * wrote no audit entries at all, and income updates wrote none either — so
 * "who changed 5,000,000 to 500,000?" had no answer anywhere in the system.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTenant, type TenantFixture } from './helpers';
import { createE2EApp, truncateAll } from './setup-e2e';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(60_000);

describe('Audit trail (e2e)', () => {
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
    tenant = await createTenant(app, 'Audit');
  });

  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const api = () => request(app.getHttpServer());

  const entriesFor = (entityType: string, entityId?: string) =>
    prisma.auditLog.findMany({
      where: { entityType, entityId, companyId: tenant.company.id },
      orderBy: { createdAt: 'asc' },
    });

  it('records a driver salary change with both sides of it', async () => {
    await api()
      .patch(`/api/v1/drivers/${tenant.driver.id}`)
      .set(as(tenant.tokens.owner))
      .send({ salaryValue: '500000000' })
      .expect(200);

    const [entry] = await entriesFor('Driver', tenant.driver.id);
    expect(entry?.action).toBe('UPDATE');
    expect(entry?.userId).toBe(tenant.owner.id);
    // BigInt money arrives as a string: JSON has no BigInt, and a float would
    // quietly lose tiyin.
    expect((entry?.after as Record<string, unknown>).salaryValue).toBe('500000000');
    expect(entry?.before).toBeDefined();
  });

  it('records client changes, which is where balances live', async () => {
    await api()
      .patch(`/api/v1/clients/${tenant.client.id}`)
      .set(as(tenant.tokens.owner))
      .send({ name: 'Renamed Client' })
      .expect(200);

    const [entry] = await entriesFor('Client', tenant.client.id);
    expect(entry?.action).toBe('UPDATE');
    expect((entry?.before as Record<string, unknown>).name).toBe(tenant.client.name);
    expect((entry?.after as Record<string, unknown>).name).toBe('Renamed Client');
  });

  it('records vehicle deactivation', async () => {
    // A spare truck: the fixture's own is booked on the fixture trip, and
    // TASK-3.10 refuses to retire anything that is still committed to a trip.
    const spare = await prisma.vehicle.create({
      data: { companyId: tenant.company.id, plateNumber: `01SPARE${randomUUID().slice(0, 4)}` },
    });

    await api().delete(`/api/v1/vehicles/${spare.id}`).set(as(tenant.tokens.owner)).expect(200);

    const [entry] = await entriesFor('Vehicle', spare.id);
    expect(entry?.action).toBe('DEACTIVATE');
    expect((entry?.after as Record<string, unknown>).isActive).toBe(false);
  });

  it('records every money mutation, including income updates', async () => {
    const expense = await api()
      .post('/api/v1/expenses')
      .set('idempotency-key', randomUUID())
      .set(as(tenant.tokens.owner))
      .send({
        category: 'FUEL',
        amount: '121500000',
        expenseDate: new Date().toISOString(),
        tripId: tenant.trip.id,
      })
      .expect(201);

    const income = await api()
      .post('/api/v1/incomes')
      .set('idempotency-key', randomUUID())
      .set(as(tenant.tokens.owner))
      .send({ amount: '950000000', clientId: tenant.client.id })
      .expect(201);

    await api()
      .patch(`/api/v1/incomes/${income.body.data.id}`)
      .set(as(tenant.tokens.owner))
      .send({ paymentMethod: 'bank' })
      .expect(200);

    expect(await entriesFor('Expense', expense.body.data.id)).toHaveLength(1);
    const incomeEntries = await entriesFor('Income', income.body.data.id);
    expect(incomeEntries.map((e) => e.action)).toEqual(['CREATE', 'UPDATE']);
    expect((incomeEntries[1]?.after as Record<string, unknown>).paymentMethod).toBe('bank');
  });

  it('ignores a client-supplied payment status: it comes from the ledger', async () => {
    const income = await api()
      .post('/api/v1/incomes')
      .set('idempotency-key', randomUUID())
      .set(as(tenant.tokens.owner))
      .send({ amount: '1000', clientId: tenant.client.id, status: 'PAID' })
      .expect(201);

    // Marking an unpaid trip PAID by hand used to be one <Select> away.
    expect(income.body.data.status).toBe('PENDING');
  });

  it('keeps no audit entry when the change itself rolls back', async () => {
    const before = await prisma.auditLog.count();

    // An expense referencing a trip from nowhere: the write fails, and the
    // audit row must not survive it.
    await api()
      .post('/api/v1/expenses')
      .set('idempotency-key', randomUUID())
      .set(as(tenant.tokens.owner))
      .send({
        category: 'FUEL',
        amount: '1000',
        expenseDate: new Date().toISOString(),
        tripId: '11111111-1111-4111-8111-111111111111',
      })
      .expect(404);

    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('never records a password, even as a masked value', async () => {
    await api()
      .post('/api/v1/users')
      .set(as(tenant.tokens.owner))
      .send({
        fullName: 'Yangi Logist',
        email: `logist-${Date.now()}@example.test`,
        password: 'Qwerty9Parol',
        role: 'LOGIST',
      })
      .expect(201);

    const entries = await prisma.auditLog.findMany({ where: { entityType: 'User' } });
    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain('Qwerty9Parol');
    expect(serialised).not.toMatch(/\$argon2/);
  });

  it('refuses to let anyone rewrite or erase the trail', async () => {
    await api()
      .patch(`/api/v1/clients/${tenant.client.id}`)
      .set(as(tenant.tokens.owner))
      .send({ name: 'Changed' })
      .expect(200);

    const [entry] = await entriesFor('Client', tenant.client.id);
    expect(entry).toBeDefined();

    // The database refuses, not the application: the same credentials that
    // write the trail must not be able to launder it.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE audit_logs SET action = 'NOTHING_HAPPENED' WHERE id = '${entry!.id}'`,
      ),
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE id = '${entry!.id}'`),
    ).rejects.toThrow(/append-only/);

    const unchanged = await prisma.auditLog.findUnique({ where: { id: entry!.id } });
    expect(unchanged?.action).toBe('UPDATE');
  });

  describe('GET /audit-logs', () => {
    it('is readable by the owner, paginated and filterable', async () => {
      await api()
        .patch(`/api/v1/drivers/${tenant.driver.id}`)
        .set(as(tenant.tokens.owner))
        .send({ fullName: 'Renamed Driver' })
        .expect(200);

      const res = await api()
        .get('/api/v1/audit-logs?entityType=Driver')
        .set(as(tenant.tokens.owner));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every((row: { entityType: string }) => row.entityType === 'Driver'),
      ).toBe(true);
      expect(res.body.meta.pagination.total).toBeGreaterThan(0);
    });

    it('is not open to the rest of the office', async () => {
      expect((await api().get('/api/v1/audit-logs').set(as(tenant.tokens.logist))).status).toBe(
        403,
      );
      expect((await api().get('/api/v1/audit-logs').set(as(tenant.tokens.driver))).status).toBe(
        403,
      );
    });

    it('never shows another company trail', async () => {
      const other = await createTenant(app, 'Other');
      await api()
        .patch(`/api/v1/clients/${other.client.id}`)
        .set(as(other.tokens.owner))
        .send({ name: 'Their Client' })
        .expect(200);
      // Own activity too, so an empty list cannot pass this test by accident.
      await api()
        .patch(`/api/v1/clients/${tenant.client.id}`)
        .set(as(tenant.tokens.owner))
        .send({ name: 'Our Client' })
        .expect(200);

      const res = await api().get('/api/v1/audit-logs').set(as(tenant.tokens.owner));
      expect(res.body.data.length).toBeGreaterThan(0);
      const companies = new Set(
        (res.body.data as Array<{ companyId: string }>).map((row) => row.companyId),
      );
      expect([...companies]).toEqual([tenant.company.id]);
    });
  });
});
