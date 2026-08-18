import { Prisma } from '@prisma/client';
import { AuditService, toAuditJson } from './audit.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('toAuditJson', () => {
  it('turns money into strings so no tiyin is lost on the way in', () => {
    const row = toAuditJson({ salaryValue: 5_000_000n, amount: 419_780_000n });
    expect(row).toEqual({ salaryValue: '5000000', amount: '419780000' });
  });

  it('stringifies Decimal values rather than letting them become floats', () => {
    const row = toAuditJson({ actualDistanceKm: new Prisma.Decimal('318.5') }) as Record<
      string,
      unknown
    >;
    expect(row.actualDistanceKm).toBe('318.5');
  });

  it('records that a secret changed, never the secret', () => {
    const row = toAuditJson({
      fullName: 'Alisher',
      passwordHash: '$argon2id$v=19$m=65536...',
      refreshToken: 'a-token',
    }) as Record<string, unknown>;

    expect(row.fullName).toBe('Alisher');
    expect(row.passwordHash).toBeUndefined();
    expect(row.refreshToken).toBeUndefined();
    // The fact of the change is still auditable.
    expect(row.passwordChanged).toBe(true);
    expect(row.refreshTokenChanged).toBe(true);
    expect(JSON.stringify(row)).not.toContain('argon2');
  });

  it('formats dates as ISO strings', () => {
    const row = toAuditJson({ createdAt: new Date('2026-08-17T10:00:00Z') }) as Record<
      string,
      unknown
    >;
    expect(row.createdAt).toBe('2026-08-17T10:00:00.000Z');
  });

  it('handles nested objects and empty input', () => {
    expect(toAuditJson({ nested: { amount: 5n } })).toEqual({ nested: { amount: '5' } });
    expect(toAuditJson(null)).toEqual({});
    expect(toAuditJson(undefined)).toEqual({});
  });
});

describe('AuditService', () => {
  function setup() {
    const create = jest.fn().mockResolvedValue({ id: 'a1' });
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    return { service: new AuditService(prisma), create };
  }

  it('writes the entry with the tenant and author attached', async () => {
    const { service, create } = setup();
    service.log({
      companyId: 'company-a',
      userId: 'user-1',
      action: 'UPDATE',
      entityType: 'Driver',
      entityId: 'd1',
    });
    await Promise.resolve();

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        userId: 'user-1',
        action: 'UPDATE',
        entityType: 'Driver',
        entityId: 'd1',
      }),
    });
  });

  it('never breaks the user flow when the audit write fails', async () => {
    const { service, create } = setup();
    create.mockRejectedValue(new Error('database is gone'));

    // Fire-and-forget by design for secondary events: losing a login record is
    // bad, refusing the login because of it is worse.
    expect(() => service.log({ action: 'LOGIN', entityType: 'User' })).not.toThrow();
    await Promise.resolve();
  });

  it('logInTx writes through the caller transaction so both land or neither does', async () => {
    const { service } = setup();
    const txCreate = jest.fn().mockResolvedValue({ id: 'a1' });

    await service.logInTx(
      { auditLog: { create: txCreate } },
      {
        action: 'CREATE',
        entityType: 'Expense',
        entityId: 'e1',
      },
    );

    expect(txCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CREATE', entityType: 'Expense' }),
    });
  });

  it('logInTx propagates a failure instead of swallowing it', async () => {
    const { service } = setup();
    const txCreate = jest.fn().mockRejectedValue(new Error('constraint violation'));

    // The caller's transaction must roll back with it: a money change whose
    // audit row failed has to fail too.
    await expect(
      service.logInTx({ auditLog: { create: txCreate } }, { action: 'X', entityType: 'Y' }),
    ).rejects.toThrow('constraint violation');
  });
});
