import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppException } from '../../common/exceptions/app.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { UsersService } from '../users/users.service';
import { AuthService, ttlToSeconds } from './auth.service';
import type { TokenVersionService } from '../../common/auth/token-version.service';

const ENV: Record<string, string> = {
  JWT_ACCESS_SECRET: 'test-access-secret-1234567890',
  JWT_REFRESH_SECRET: 'test-refresh-secret-1234567890',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
};

describe('ttlToSeconds', () => {
  it('parses s/m/h/d units', () => {
    expect(ttlToSeconds('45s')).toBe(45);
    expect(ttlToSeconds('15m')).toBe(900);
    expect(ttlToSeconds('2h')).toBe(7200);
    expect(ttlToSeconds('30d')).toBe(2_592_000);
  });

  it('rejects malformed TTLs', () => {
    expect(() => ttlToSeconds('15min')).toThrow();
  });
});

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { update: jest.Mock };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let usersService: { findByIdentifier: jest.Mock; findById: jest.Mock };
  let audit: { log: jest.Mock };
  let user: User;
  const jwtService = new JwtService({});

  beforeEach(async () => {
    user = {
      id: 'user-1',
      companyId: 'company-a',
      fullName: 'Test Owner',
      phone: '+998901234567',
      email: 'owner@test.uz',
      passwordHash: await argon2.hash('correct-password'),
      role: 'OWNER',
      isActive: true,
      lastLogin: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User;

    prisma = {
      user: { update: jest.fn() },
      refreshToken: {
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'rt-new', ...data }),
          ),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    usersService = { findByIdentifier: jest.fn(), findById: jest.fn() };
    audit = { log: jest.fn() };

    service = new AuthService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
      jwtService,
      { getOrThrow: (key: string) => ENV[key] } as unknown as ConfigService,
      audit as unknown as AuditService,
      {
        currentFor: jest.fn().mockResolvedValue(0),
        invalidate: jest.fn(),
        clear: jest.fn(),
      } as unknown as TokenVersionService,
    );
  });

  describe('login', () => {
    it('returns a token pair with tenant claims in the access token', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);

      const tokens = await service.login('owner@test.uz', 'correct-password');

      const payload = jwtService.decode(tokens.accessToken) as Record<string, unknown>;
      expect(payload.sub).toBe('user-1');
      expect(payload.companyId).toBe('company-a');
      expect(payload.role).toBe('OWNER');
      expect(prisma.refreshToken.create).toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN' }));
    });

    it('rejects unknown identifier with AUTH_INVALID_CREDENTIALS', async () => {
      usersService.findByIdentifier.mockResolvedValue(null);
      await expect(service.login('ghost@test.uz', 'x')).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
    });

    it('rejects wrong password with the same code (no user enumeration)', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);
      await expect(service.login('owner@test.uz', 'wrong')).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
    });

    it('rejects inactive users', async () => {
      usersService.findByIdentifier.mockResolvedValue({ ...user, isActive: false });
      await expect(service.login('owner@test.uz', 'correct-password')).rejects.toMatchObject({
        code: 'AUTH_USER_INACTIVE',
      });
    });
  });

  describe('refresh', () => {
    it('rotates the token: revokes the old one and issues a new pair', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);
      usersService.findById.mockResolvedValue(user);
      const { refreshToken } = await service.login('owner@test.uz', 'correct-password');
      const storedHash = prisma.refreshToken.create.mock.calls[0][0].data.tokenHash;
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'fam-1',
        tokenHash: storedHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      const newTokens = await service.refresh(refreshToken);

      expect(newTokens.accessToken).toBeTruthy();
      // Compare-and-set: the revocation only applies to a row still unrevoked.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      // The new token continues the same family and records the chain.
      expect(prisma.refreshToken.create.mock.calls.at(-1)![0].data.familyId).toBe('fam-1');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { replacedById: 'rt-new' },
      });
    });

    it('a parallel refresh loses the compare-and-set instead of minting a second pair', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);
      usersService.findById.mockResolvedValue(user);
      const { refreshToken } = await service.login('owner@test.uz', 'correct-password');
      const storedHash = prisma.refreshToken.create.mock.calls[0][0].data.tokenHash;
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'fam-1',
        tokenHash: storedHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      // The other request got there first: no row left to revoke.
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh(refreshToken)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_INVALID',
      });
    });

    it('replaying a rotated token revokes the whole family (reuse detection)', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);
      usersService.findById.mockResolvedValue(user);
      const { refreshToken } = await service.login('owner@test.uz', 'correct-password');
      const storedHash = prisma.refreshToken.create.mock.calls[0][0].data.tokenHash;
      // Already rotated — so this copy is either a race or a stolen token.
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'fam-1',
        tokenHash: storedHash,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      await expect(service.refresh(refreshToken)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSED',
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFRESH_REUSE_DETECTED' }),
      );
    });

    it('a fresh login starts its own token family', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);
      await service.login('owner@test.uz', 'correct-password');
      const first = prisma.refreshToken.create.mock.calls[0][0].data.familyId;

      await service.login('owner@test.uz', 'correct-password');
      const second = prisma.refreshToken.create.mock.calls[1][0].data.familyId;

      expect(first).toBeTruthy();
      expect(second).not.toBe(first);
    });

    it('purges expired refresh tokens on its schedule', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 });
      await service.purgeExpiredRefreshTokens();

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('treats a revoked refresh token as reuse, not a plain rejection', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);
      const { refreshToken } = await service.login('owner@test.uz', 'correct-password');
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'fam-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      await expect(service.refresh(refreshToken)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSED',
      });
    });

    it('rejects garbage tokens', async () => {
      await expect(service.refresh('not-a-jwt')).rejects.toBeInstanceOf(AppException);
    });
  });

  describe('me', () => {
    it('never returns the password hash', async () => {
      usersService.findById.mockResolvedValue(user);
      const result = await service.me('user-1');
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.email).toBe('owner@test.uz');
    });
  });

  describe('account lockout (TASK-2.5)', () => {
    beforeEach(() => {
      usersService.findByIdentifier.mockResolvedValue(user);
    });

    it('counts a wrong password without locking straight away', async () => {
      await expect(service.login('owner@test.uz', 'wrong')).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { failedLoginAttempts: 1, lockedUntil: null },
      });
    });

    it('locks the account on the tenth consecutive failure', async () => {
      usersService.findByIdentifier.mockResolvedValue({ ...user, failedLoginAttempts: 9 });

      await expect(service.login('owner@test.uz', 'wrong')).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.lockedUntil).toBeInstanceOf(Date);
      // The counter restarts so the next run has to earn the lock again.
      expect(data.failedLoginAttempts).toBe(0);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ACCOUNT_LOCKED' }));
    });

    it('refuses a locked account before checking the password at all', async () => {
      usersService.findByIdentifier.mockResolvedValue({
        ...user,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(service.login('owner@test.uz', 'correct-password')).rejects.toMatchObject({
        code: 'AUTH_ACCOUNT_LOCKED',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('an expired lock lets the user back in', async () => {
      usersService.findByIdentifier.mockResolvedValue({
        ...user,
        lockedUntil: new Date(Date.now() - 60_000),
        failedLoginAttempts: 7,
      });

      const tokens = await service.login('owner@test.uz', 'correct-password');
      expect(tokens.accessToken).toBeTruthy();
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null }),
        }),
      );
    });

    it('refuses a deactivated account without confirming the password (M-1)', async () => {
      usersService.findByIdentifier.mockResolvedValue({ ...user, isActive: false });

      await expect(service.login('owner@test.uz', 'correct-password')).rejects.toMatchObject({
        code: 'AUTH_USER_INACTIVE',
      });
      // No counter update: the password was never examined.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
