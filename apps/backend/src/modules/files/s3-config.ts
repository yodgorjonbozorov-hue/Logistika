/**
 * Object-storage settings, resolved from the environment.
 *
 * The bucket is addressed over plain S3, so the same code serves MinIO in dev
 * and any managed S3-compatible store in production (Cloudflare R2, AWS S3,
 * Supabase Storage). The `S3_*` names are canonical; the older `MINIO_*` names
 * still work so an existing `.env` and docker-compose keep running unchanged.
 */
export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Set by stores that authenticate with a temporary token (Supabase). */
  sessionToken?: string;
  /**
   * Path-style addressing (`host/bucket/key`) rather than virtual-hosted
   * (`bucket.host/key`). Required by MinIO and by any endpoint that carries a
   * path prefix; AWS S3 proper prefers virtual-hosted.
   */
  forcePathStyle: boolean;
}

type Reader = (key: string) => string | undefined;

/**
 * Builds the endpoint URL. `S3_ENDPOINT` is taken as a full URL so that stores
 * mounted under a path — Supabase serves S3 at `/storage/v1/s3` — can be
 * expressed at all; the legacy host/port/SSL trio is assembled when it is absent.
 */
export function resolveS3Settings(read: Reader): S3Settings {
  const explicit = read('S3_ENDPOINT');
  const endpoint = explicit
    ? explicit.replace(/\/+$/, '')
    : `${read('MINIO_USE_SSL') === 'true' ? 'https' : 'http'}://${
        read('MINIO_ENDPOINT') ?? 'localhost'
      }:${read('MINIO_PORT') ?? '9000'}`;

  return {
    endpoint,
    region: read('S3_REGION') ?? read('MINIO_REGION') ?? 'us-east-1',
    bucket: read('S3_BUCKET') ?? read('MINIO_BUCKET') ?? 'truckcontrol',
    accessKeyId: read('S3_ACCESS_KEY_ID') ?? read('MINIO_ROOT_USER') ?? 'truckcontrol',
    secretAccessKey: read('S3_SECRET_ACCESS_KEY') ?? read('MINIO_ROOT_PASSWORD') ?? '',
    sessionToken: read('S3_SESSION_TOKEN') || undefined,
    // Default on: it is what MinIO and path-mounted endpoints need, and the one
    // store that prefers virtual-hosted (AWS S3) accepts an explicit opt-out.
    forcePathStyle: (read('S3_FORCE_PATH_STYLE') ?? 'true') !== 'false',
  };
}
