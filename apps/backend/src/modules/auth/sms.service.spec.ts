/**
 * The one thing this wrapper must never do is print a login code where it can
 * be read later. Development prints it on purpose — that is how driver login is
 * testable without a gateway — so the boundary between the two behaviours is
 * worth pinning down rather than trusting.
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service';

const configFor = (values: Record<string, string | undefined>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('SmsService without a configured gateway', () => {
  let logged: string[];
  let errors: string[];

  beforeEach(() => {
    logged = [];
    errors = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('prints the code in development — that is the point of the dev path', async () => {
    await new SmsService(configFor({ NODE_ENV: 'development' })).send(
      '+998901234567',
      'Kod: 123456',
    );
    expect(logged.join()).toContain('123456');
  });

  it('never prints the code in production', async () => {
    await new SmsService(configFor({ NODE_ENV: 'production' })).send(
      '+998901234567',
      'Kod: 123456',
    );

    expect(logged.join()).not.toContain('123456');
    expect(errors.join()).not.toContain('123456');
    expect(errors.join()).not.toContain('+998901234567');
  });

  it('reports the misconfiguration in production instead of failing silently', async () => {
    await new SmsService(configFor({ NODE_ENV: 'production' })).send(
      '+998901234567',
      'Kod: 123456',
    );
    // Driver login is broken at this point; somebody has to be told.
    expect(errors.join()).toMatch(/SMS_PROVIDER_URL is not configured/);
  });

  it('never throws — a gateway problem must not block the login flow', async () => {
    await expect(
      new SmsService(configFor({ NODE_ENV: 'production' })).send('+998901234567', 'Kod: 1'),
    ).resolves.toBeUndefined();
  });
});
