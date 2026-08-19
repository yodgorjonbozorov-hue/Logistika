import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { CronGuard } from './cron.guard';

const SECRET = 'a-cron-secret-at-least-16';

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}

function guard(secret: string | undefined): CronGuard {
  return new CronGuard({ get: () => secret } as unknown as ConfigService);
}

describe('CronGuard', () => {
  it('accepts the configured secret as a bearer token', () => {
    expect(guard(SECRET).canActivate(context(`Bearer ${SECRET}`))).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(() => guard(SECRET).canActivate(context('Bearer wrong-secret-value1'))).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_INVALID' }),
    );
  });

  it('rejects a secret of a different length without throwing on the compare', () => {
    expect(() => guard(SECRET).canActivate(context('Bearer short'))).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_INVALID' }),
    );
  });

  it('rejects a missing or non-bearer authorization header', () => {
    expect(() => guard(SECRET).canActivate(context(undefined))).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_INVALID' }),
    );
    expect(() => guard(SECRET).canActivate(context(`Basic ${SECRET}`))).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_INVALID' }),
    );
  });

  it('stays closed when no secret is configured, even with a token', () => {
    expect(() => guard(undefined).canActivate(context('Bearer anything'))).toThrow(
      expect.objectContaining({ code: 'AUTH_FORBIDDEN' }),
    );
  });
});
