/**
 * The boot gate.
 *
 * These rules exist to stop one specific failure: a deployment that comes up,
 * serves traffic, and looks healthy while running on the sample credentials
 * from `.env.example`. A gate nobody tests is a gate that quietly stops
 * working, so every rule here has a case that proves it still bites — and a
 * matching case that proves it does not bite the legitimate deployment it
 * would otherwise punish (loopback datastores, an explicit TRUST_PROXY=0).
 */
import { validateEnv } from './env.validation';

/** A production environment with nothing wrong with it. */
const SOUND: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://truckai:Xk29fLp7Qw3z@127.0.0.1:5432/truckai?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'RGqM4mPz8bV2sT7nHc5wY1dLf6jX0kA3uE9rB',
  JWT_REFRESH_SECRET: 'Zt3wQ7yN2xC8vK5pJ4hR9mD6sG1bF0aU',
  WEB_URL: 'https://app.truckai.uz',
  MINIO_ENDPOINT: '127.0.0.1',
  MINIO_ROOT_PASSWORD: 'Nb8rT2kW6yQ4mZ9x',
  TRUST_PROXY: '1',
};

const failuresFor = (over: Record<string, string | undefined>): string => {
  try {
    validateEnv({ ...SOUND, ...over });
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('validateEnv — production gate', () => {
  it('accepts a sound production environment', () => {
    expect(() => validateEnv(SOUND)).not.toThrow();
  });

  it('refuses a placeholder JWT secret', () => {
    expect(failuresFor({ JWT_ACCESS_SECRET: 'replace-with-32+-random-chars-access-xx' })).toMatch(
      /JWT_ACCESS_SECRET: still set to a sample/,
    );
  });

  it('refuses one secret used for both token kinds', () => {
    const both = SOUND.JWT_ACCESS_SECRET;
    expect(failuresFor({ JWT_REFRESH_SECRET: both })).toMatch(/must differ/);
  });

  it('refuses the sample database password', () => {
    expect(
      failuresFor({ DATABASE_URL: 'postgresql://truckcontrol:change-me@db:5432/truckai' }),
    ).toMatch(/DATABASE_URL: still contains a sample/);
  });

  it.each([
    ['http://app.truckai.uz', /https:\/\/ origin/],
    ['https://localhost:5173', /placeholder, not a real domain/],
    ['https://app.example.com', /placeholder, not a real domain/],
  ])('refuses WEB_URL %s', (url, expected) => {
    expect(failuresFor({ WEB_URL: url })).toMatch(expected);
  });

  it('refuses plaintext object storage on another host', () => {
    expect(failuresFor({ MINIO_ENDPOINT: 'storage.internal', MINIO_USE_SSL: 'false' })).toMatch(
      /MINIO_USE_SSL: must be true/,
    );
  });

  it('allows plaintext object storage over loopback — there is no network to sniff', () => {
    expect(failuresFor({ MINIO_ENDPOINT: '127.0.0.1', MINIO_USE_SSL: 'false' })).toBe('');
  });

  it('refuses an unauthenticated Redis reachable over the network', () => {
    expect(failuresFor({ REDIS_URL: 'redis://cache.internal:6379' })).toMatch(
      /REDIS_URL: a non-loopback Redis must carry credentials/,
    );
  });

  it('accepts a remote Redis that carries credentials', () => {
    expect(failuresFor({ REDIS_URL: 'rediss://default:Vb7kQ2mZ@cache.internal:6379' })).toBe('');
  });

  it('refuses a short or missing storage password', () => {
    expect(failuresFor({ MINIO_ROOT_PASSWORD: 'short' })).toMatch(/min 12 chars/);
  });

  it('demands an explicit TRUST_PROXY decision, and accepts either answer', () => {
    expect(failuresFor({ TRUST_PROXY: undefined })).toMatch(/must be set explicitly/);
    expect(failuresFor({ TRUST_PROXY: '0' })).toBe('');
    expect(failuresFor({ TRUST_PROXY: '1' })).toBe('');
  });

  it('refuses a real AI provider with no key', () => {
    expect(failuresFor({ AI_PROVIDER: 'anthropic', AI_API_KEY: '' })).toMatch(
      /AI_API_KEY: required/,
    );
  });

  it('leaves development alone — the sample values are the point there', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://truckcontrol:change-me@localhost:5432/truckcontrol',
        JWT_ACCESS_SECRET: 'replace-with-32+-random-chars-access-xxxxxxxx',
        JWT_REFRESH_SECRET: 'replace-with-32+-random-chars-refresh-xxxxxxx',
      }),
    ).not.toThrow();
  });

  it('reports every problem at once rather than one per restart', () => {
    const message = failuresFor({
      WEB_URL: 'http://localhost:5173',
      MINIO_ROOT_PASSWORD: 'short',
      TRUST_PROXY: undefined,
    });
    expect(message).toMatch(/WEB_URL/);
    expect(message).toMatch(/MINIO_ROOT_PASSWORD/);
    expect(message).toMatch(/TRUST_PROXY/);
  });
});
