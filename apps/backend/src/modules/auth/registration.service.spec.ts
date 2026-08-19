import * as argon2 from 'argon2';
import { TARIFF_TRIAL, TRIAL_DAYS } from 'shared';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthService } from './auth.service';
import { RegistrationService, trialEndsAt } from './registration.service';

const VALID = {
  companyName: '  Yo‘l Logistika  ',
  fullName: '  Umar Karimov ',
  email: 'Owner@Example.UZ',
  phone: '+998901112233',
  password: 'StrongPass123',
};

/** A Prisma unique-constraint violation, as the client raises it. */
function uniqueViolation(target: string[]): Error & { code: string; meta: { target: string[] } } {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target } });
}

describe('trialEndsAt', () => {
  it('lands exactly TRIAL_DAYS later', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(trialEndsAt(from).toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe('RegistrationService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: { company: { create: jest.Mock }; user: { create: jest.Mock } };
  let authService: { issueTokens: jest.Mock };
  let audit: { log: jest.Mock };
  let service: RegistrationService;

  beforeEach(() => {
    tx = {
      company: { create: jest.fn().mockResolvedValue({ id: 'c1', name: 'Yo‘l Logistika' }) },
      user: { create: jest.fn().mockResolvedValue({ id: 'u1', companyId: 'c1', role: 'OWNER' }) },
    };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    authService = {
      issueTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
    };
    audit = { log: jest.fn() };
    service = new RegistrationService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
      audit as unknown as AuditService,
    );
  });

  it('creates the company on a 14-day trial and signs the owner in', async () => {
    const before = Date.now();
    await expect(service.register({ ...VALID })).resolves.toEqual({
      accessToken: 'a',
      refreshToken: 'r',
    });

    const company = tx.company.create.mock.calls[0][0].data;
    expect(company.name).toBe('Yo‘l Logistika'); // trimmed
    expect(company.tariffPlan).toBe(TARIFF_TRIAL);
    const days = (company.subscriptionUntil.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(TRIAL_DAYS - 0.01);
    expect(days).toBeLessThan(TRIAL_DAYS + 0.01);

    expect(authService.issueTokens).toHaveBeenCalledWith({
      id: 'u1',
      companyId: 'c1',
      role: 'OWNER',
    });
  });

  it('makes the first user an OWNER of the company it just created', async () => {
    await service.register({ ...VALID });
    const user = tx.user.create.mock.calls[0][0].data;
    expect(user).toMatchObject({ companyId: 'c1', role: 'OWNER', fullName: 'Umar Karimov' });
    expect(user.email).toBe('owner@example.uz'); // normalised
    expect(user.passwordHash).not.toBe(VALID.password);
    await expect(argon2.verify(user.passwordHash, VALID.password)).resolves.toBe(true);
  });

  it('never stores a password in the clear', async () => {
    await service.register({ ...VALID });
    expect(JSON.stringify(tx.user.create.mock.calls[0][0])).not.toContain(VALID.password);
  });

  it('rejects an e-mail that already belongs to someone', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'someone-else' });
    await expect(service.register({ ...VALID })).rejects.toMatchObject({
      code: 'AUTH_EMAIL_TAKEN',
      httpStatus: 409,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a phone that already belongs to someone', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null) // e-mail is free
      .mockResolvedValueOnce({ id: 'someone-else' }); // phone is not
    await expect(service.register({ ...VALID })).rejects.toMatchObject({
      code: 'AUTH_PHONE_TAKEN',
      httpStatus: 409,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('turns a lost race on the unique index into the same conflict', async () => {
    prisma.$transaction.mockRejectedValue(uniqueViolation(['email']));
    await expect(service.register({ ...VALID })).rejects.toMatchObject({
      code: 'AUTH_EMAIL_TAKEN',
    });

    prisma.$transaction.mockRejectedValue(uniqueViolation(['phone']));
    await expect(service.register({ ...VALID })).rejects.toMatchObject({
      code: 'AUTH_PHONE_TAKEN',
    });
  });

  it('lets an unrelated database failure through untouched', async () => {
    prisma.$transaction.mockRejectedValue(new Error('connection reset'));
    await expect(service.register({ ...VALID })).rejects.toThrow('connection reset');
  });

  it('skips the phone entirely when none was given', async () => {
    await service.register({ ...VALID, phone: undefined });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1); // e-mail only
    expect(tx.user.create.mock.calls[0][0].data.phone).toBeUndefined();
    expect(tx.company.create.mock.calls[0][0].data.phone).toBeUndefined();
  });

  it('records the sign-up in the audit log', async () => {
    await service.register({ ...VALID });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'c1',
        userId: 'u1',
        action: 'CREATE',
        entityType: 'Company',
      }),
    );
  });
});
