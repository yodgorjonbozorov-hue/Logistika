import { resolveS3Settings } from './s3-config';

const reader = (env: Record<string, string>) => (key: string) => env[key];

describe('resolveS3Settings', () => {
  it('assembles the endpoint from the legacy MinIO trio', () => {
    const s = resolveS3Settings(
      reader({ MINIO_ENDPOINT: 'localhost', MINIO_PORT: '9000', MINIO_USE_SSL: 'false' }),
    );
    expect(s.endpoint).toBe('http://localhost:9000');
    expect(s.forcePathStyle).toBe(true);
  });

  it('switches the legacy endpoint to https when SSL is on', () => {
    const s = resolveS3Settings(
      reader({ MINIO_ENDPOINT: 'files.example.com', MINIO_PORT: '443', MINIO_USE_SSL: 'true' }),
    );
    expect(s.endpoint).toBe('https://files.example.com:443');
  });

  it('takes S3_ENDPOINT as a whole URL, so a path-mounted store works', () => {
    const s = resolveS3Settings(
      reader({ S3_ENDPOINT: 'https://ref.supabase.co/storage/v1/s3', MINIO_ENDPOINT: 'ignored' }),
    );
    expect(s.endpoint).toBe('https://ref.supabase.co/storage/v1/s3');
  });

  it('trims a trailing slash off the endpoint', () => {
    const s = resolveS3Settings(reader({ S3_ENDPOINT: 'https://store.example.com/s3/' }));
    expect(s.endpoint).toBe('https://store.example.com/s3');
  });

  it('prefers S3_* over the legacy names', () => {
    const s = resolveS3Settings(
      reader({
        S3_BUCKET: 'new',
        MINIO_BUCKET: 'old',
        S3_ACCESS_KEY_ID: 'new-key',
        MINIO_ROOT_USER: 'old-key',
        S3_SECRET_ACCESS_KEY: 'new-secret',
        MINIO_ROOT_PASSWORD: 'old-secret',
        S3_REGION: 'eu-central-1',
        MINIO_REGION: 'auto',
      }),
    );
    expect(s).toMatchObject({
      bucket: 'new',
      accessKeyId: 'new-key',
      secretAccessKey: 'new-secret',
      region: 'eu-central-1',
    });
  });

  it('falls back to the legacy names when no S3_* is set', () => {
    const s = resolveS3Settings(
      reader({ MINIO_BUCKET: 'old', MINIO_ROOT_USER: 'u', MINIO_ROOT_PASSWORD: 'p' }),
    );
    expect(s).toMatchObject({ bucket: 'old', accessKeyId: 'u', secretAccessKey: 'p' });
  });

  it('carries a session token only when one is configured', () => {
    expect(resolveS3Settings(reader({})).sessionToken).toBeUndefined();
    expect(resolveS3Settings(reader({ S3_SESSION_TOKEN: '' })).sessionToken).toBeUndefined();
    expect(resolveS3Settings(reader({ S3_SESSION_TOKEN: 'tok' })).sessionToken).toBe('tok');
  });

  it('keeps path-style on by default and lets AWS-proper opt out', () => {
    expect(resolveS3Settings(reader({})).forcePathStyle).toBe(true);
    expect(resolveS3Settings(reader({ S3_FORCE_PATH_STYLE: 'false' })).forcePathStyle).toBe(false);
  });

  it('defaults the region so signing never fails on a missing value', () => {
    expect(resolveS3Settings(reader({})).region).toBe('us-east-1');
  });
});
