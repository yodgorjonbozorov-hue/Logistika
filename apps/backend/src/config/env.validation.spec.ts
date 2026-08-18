// Decorators run at import time and need the metadata polyfill.
import 'reflect-metadata';
import { publicStorageEndpoint, validateEnv } from './env.validation';

const VALID = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  WEB_URL: 'http://localhost:5173',
  MINIO_ENDPOINT: 'localhost',
  MINIO_BUCKET: 'truckcontrol',
  MINIO_ROOT_USER: 'truckcontrol',
  MINIO_ROOT_PASSWORD: 'storage-password',
};

const PRODUCTION = {
  ...VALID,
  NODE_ENV: 'production',
  WEB_URL: 'https://app.truckcontrol.uz',
  MINIO_USE_SSL: 'true',
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

  describe('storage configuration', () => {
    it('refuses to start without the MinIO password', () => {
      const { MINIO_ROOT_PASSWORD: _omitted, ...withoutPassword } = VALID;
      // Booting without it used to succeed and fail on every upload instead.
      expect(() => validateEnv(withoutPassword)).toThrow(/MINIO_ROOT_PASSWORD/);
    });

    it('refuses to start without a bucket or endpoint', () => {
      const { MINIO_BUCKET: _bucket, ...withoutBucket } = VALID;
      expect(() => validateEnv(withoutBucket)).toThrow(/MINIO_BUCKET/);
      const { MINIO_ENDPOINT: _endpoint, ...withoutEndpoint } = VALID;
      expect(() => validateEnv(withoutEndpoint)).toThrow(/MINIO_ENDPOINT/);
    });

    it('refuses to start without WEB_URL, which CORS reads with getOrThrow', () => {
      const { WEB_URL: _omitted, ...withoutWebUrl } = VALID;
      expect(() => validateEnv(withoutWebUrl)).toThrow(/WEB_URL/);
    });

    it('signs download urls with the public endpoint when one is configured', () => {
      expect(
        publicStorageEndpoint({
          MINIO_ENDPOINT: 'minio',
          MINIO_PUBLIC_ENDPOINT: 'files.truckcontrol.uz',
          MINIO_PORT: 9000,
          MINIO_PUBLIC_PORT: 443,
          MINIO_USE_SSL: 'false',
          MINIO_PUBLIC_USE_SSL: 'true',
        }),
      ).toEqual({ endPoint: 'files.truckcontrol.uz', port: 443, useSSL: true });
    });

    it('falls back to the internal endpoint when no public one is set', () => {
      expect(
        publicStorageEndpoint({
          MINIO_ENDPOINT: 'localhost',
          MINIO_PORT: 9000,
          MINIO_USE_SSL: 'false',
        }),
      ).toEqual({ endPoint: 'localhost', port: 9000, useSSL: false });
    });
  });

  describe('production hardening', () => {
    it('accepts a hardened production configuration', () => {
      expect(validateEnv(PRODUCTION).NODE_ENV).toBe('production');
    });

    it('refuses short secrets in production even though dev allows them', () => {
      const shortButLegal = 'c'.repeat(20);
      expect(validateEnv({ ...VALID, JWT_ACCESS_SECRET: shortButLegal }).NODE_ENV).toBe(
        'development',
      );
      expect(() => validateEnv({ ...PRODUCTION, JWT_ACCESS_SECRET: shortButLegal })).toThrow(
        /at least 32/,
      );
    });

    it('refuses the same secret for access and refresh tokens in production', () => {
      const same = 'd'.repeat(40);
      expect(() =>
        validateEnv({ ...PRODUCTION, JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same }),
      ).toThrow(/must differ/);
    });

    it('refuses plaintext storage and a non-https web url in production', () => {
      expect(() => validateEnv({ ...PRODUCTION, MINIO_USE_SSL: 'false' })).toThrow(/MINIO_USE_SSL/);
      expect(() => validateEnv({ ...PRODUCTION, WEB_URL: 'http://app.truckcontrol.uz' })).toThrow(
        /https/,
      );
    });
  });
});
