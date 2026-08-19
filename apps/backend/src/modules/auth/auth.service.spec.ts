import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppException } from '../../common/exceptions/app.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { UsersService } from '../users/users.service';
import { AuthService, ttlToSeconds } from './auth.service';

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
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User;

    prisma = {
      user: { update: jest.fn() },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
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
      const familyId = prisma.refreshToken.create.mock.calls[0][0].data.familyId;
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        tokenHash: storedHash,
        familyId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const newTokens = await service.refresh(refreshToken);

      expect(newTokens.accessToken).toBeTruthy();
      // Rotation is a conditional update so two parallel refreshes cannot both win.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      // The replacement token stays in the same family (M-5).
      expect(prisma.refreshToken.create.mock.calls[1][0].data.familyId).toBe(familyId);
    });

    it('revokes the whole family when an already-rotated token is replayed (M-5)', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);
      usersService.findById.mockResolvedValue(user);
      const { refreshToken } = await service.login('owner@test.uz', 'correct-password');
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: new Date(), // already rotated → replay
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      await expect(service.refresh(refreshToken)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_INVALID',
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFRESH_REUSE_DETECTED' }),
      );
    });

    it('loses a concurrent rotation race without minting a second pair', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);
      usersService.findById.mockResolvedValue(user);
      const { refreshToken } = await service.login('owner@test.uz', 'correct-password');
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 }); // somebody else won

      await expect(service.refresh(refreshToken)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_INVALID',
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1); // login only
    });

    it('rejects a revoked refresh token', async () => {
      usersService.findByIdentifier.mockResolvedValue(user);
      const { refreshToken } = await service.login('owner@test.uz', 'correct-password');
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'family-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      await expect(service.refresh(refreshToken)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_INVALID',
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
});
