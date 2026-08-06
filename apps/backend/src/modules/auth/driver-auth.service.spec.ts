import type { ConfigService } from '@nestjs/config';
import { I18nService } from '../../i18n/i18n.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import type { AuthService } from './auth.service';
import { DriverAuthService } from './driver-auth.service';
import type { SmsService } from './sms.service';

describe('DriverAuthService', () => {
  let prisma: {
    smsCode: { deleteMany: jest.Mock; create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    user: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let usersService: { findByIdentifier: jest.Mock };
  let authService: { issueTokens: jest.Mock };
  let sms: { send: jest.Mock };
  let service: DriverAuthService;

  const driver = { id: 'u-d1', role: 'DRIVER', isActive: true, phone: '+998901112233' };

  beforeEach(() => {
    prisma = {
      smsCode: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: { update: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    usersService = { findByIdentifier: jest.fn() };
    authService = {
      issueTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
    };
    sms = { send: jest.fn() };
    service = new DriverAuthService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
      authService as unknown as AuthService,
      sms as unknown as SmsService,
      { get: () => 'development' } as unknown as ConfigService,
      new I18nService(),
    );
  });

  it('reports success without sending anything for unknown phones (no enumeration)', async () => {
    usersService.findByIdentifier.mockResolvedValue(null);
    const result = await service.requestCode('+998900000000');
    expect(result.sent).toBe(true);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('does not issue codes to office accounts', async () => {
    usersService.findByIdentifier.mockResolvedValue({ ...driver, role: 'OWNER' });
    await service.requestCode(driver.phone);
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('sends a 6-digit code for an active driver (dev echoes the code)', async () => {
    usersService.findByIdentifier.mockResolvedValue(driver);
    const result = await service.requestCode(driver.phone);
    expect(sms.send).toHaveBeenCalledWith(driver.phone, expect.stringMatching(/\d{6}/));
    expect(result.devCode).toMatch(/^\d{6}$/);
  });

  it('verify: correct code logs the driver in and clears codes', async () => {
    usersService.findByIdentifier.mockResolvedValue(driver);
    const { devCode } = await service.requestCode(driver.phone);
    const stored = prisma.$transaction.mock.calls[0][0];
    // Re-create the stored record from the create() call inside the transaction array.
    const createArg = prisma.smsCode.create.mock.calls[0][0].data;
    prisma.smsCode.findFirst.mockResolvedValue({
      id: 'c1',
      ...createArg,
      attempts: 0,
    });
    expect(stored).toBeDefined();

    const tokens = await service.verify(driver.phone, devCode!);

    expect(tokens.accessToken).toBe('a');
    expect(prisma.smsCode.deleteMany).toHaveBeenCalledWith({ where: { phone: driver.phone } });
  });

  it('verify: wrong code increments attempts and fails', async () => {
    usersService.findByIdentifier.mockResolvedValue(driver);
    await service.requestCode(driver.phone);
    const createArg = prisma.smsCode.create.mock.calls[0][0].data;
    prisma.smsCode.findFirst.mockResolvedValue({ id: 'c1', ...createArg, attempts: 0 });

    await expect(service.verify(driver.phone, '000000')).rejects.toMatchObject({
      code: 'SMS_CODE_INVALID',
    });
    expect(prisma.smsCode.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { attempts: { increment: 1 } },
    });
  });

  it('verify: expired or exhausted codes are rejected', async () => {
    prisma.smsCode.findFirst.mockResolvedValue({
      id: 'c1',
      phone: driver.phone,
      codeHash: 'x',
      expiresAt: new Date(Date.now() - 1000),
      attempts: 0,
    });
    await expect(service.verify(driver.phone, '123456')).rejects.toMatchObject({
      code: 'SMS_CODE_INVALID',
    });
  });
});
