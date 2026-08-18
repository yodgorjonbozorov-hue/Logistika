import { validateEnv } from './env.validation';

const BASE = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(16),
  JWT_REFRESH_SECRET: 'b'.repeat(16),
};

describe('validateEnv', () => {
  it('rejects a missing database url', () => {
    expect(() => validateEnv({ ...BASE, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects short JWT secrets', () => {
    expect(() => validateEnv({ ...BASE, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a malformed TTL', () => {
    expect(() => validateEnv({ ...BASE, JWT_ACCESS_TTL: '15minutes' })).toThrow(/JWT_ACCESS_TTL/);
  });

  /**
   * Nest replaces the whole config with this returned instance, so any key the
   * app reads must survive validation — an undeclared one silently becomes
   * undefined at the call site (this is how file uploads broke once).
   */
  it('keeps every variable the application reads', () => {
    const config = validateEnv({
      ...BASE,
      MINIO_ENDPOINT: 'storage.internal',
      MINIO_PORT: '9100',
      MINIO_ROOT_USER: 'tc',
      MINIO_ROOT_PASSWORD: 'secret-value',
      MINIO_BUCKET: 'bucket',
      MINIO_USE_SSL: 'true',
      SMS_PROVIDER_URL: 'https://sms.example',
      SMS_PROVIDER_TOKEN: 'token',
      WEB_URL: 'https://app.example',
      DEFAULT_TIMEZONE: 'Asia/Tashkent',
    });

    expect(config).toMatchObject({
      MINIO_ENDPOINT: 'storage.internal',
      MINIO_PORT: 9100,
      MINIO_ROOT_USER: 'tc',
      MINIO_ROOT_PASSWORD: 'secret-value',
      MINIO_BUCKET: 'bucket',
      MINIO_USE_SSL: 'true',
      SMS_PROVIDER_URL: 'https://sms.example',
      SMS_PROVIDER_TOKEN: 'token',
      WEB_URL: 'https://app.example',
    });
  });

  it('applies defaults when optional variables are absent', () => {
    const config = validateEnv(BASE);
    expect(config.MINIO_BUCKET).toBe('truckcontrol');
    expect(config.API_PORT).toBe(3000);
  });
});
