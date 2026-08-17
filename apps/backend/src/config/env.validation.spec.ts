// Decorators run at import time and need the metadata polyfill.
import 'reflect-metadata';
import { validateEnv } from './env.validation';

const VALID = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('accepts a complete configuration', () => {
    expect(validateEnv(VALID).NODE_ENV).toBe('development');
  });

  it('refuses to start without NODE_ENV', () => {
    const { NODE_ENV: _omitted, ...withoutNodeEnv } = VALID;
    // Silently defaulting to "development" is what turned a missing variable
    // into development-only behaviour running in production.
    expect(() => validateEnv(withoutNodeEnv)).toThrow(/NODE_ENV/);
  });

  it('refuses an unknown NODE_ENV value', () => {
    expect(() => validateEnv({ ...VALID, NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });

  it('refuses to start without a database url', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = VALID;
    expect(() => validateEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('refuses short JWT secrets', () => {
    expect(() => validateEnv({ ...VALID, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });
});
