import { plainToInstance, Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const TTL_PATTERN = /^\d+(s|m|h|d)$/;
const PRODUCTION_SECRET_MIN_LENGTH = 32;

export class EnvironmentVariables {
  // No default on purpose: a missing NODE_ENV used to mean "development",
  // which switched on development-only behaviour on a production box.
  @IsIn(['development', 'test', 'production'])
  @IsNotEmpty()
  NODE_ENV!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  API_PORT = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  /**
   * Connection used for tenant-scoped queries. Must be a role WITHOUT
   * BYPASSRLS so row-level security applies to it (docs/DEPLOYMENT.md).
   * Falls back to DATABASE_URL in development, where the database usually runs
   * as its owner and RLS is therefore inert.
   */
  @IsOptional()
  @IsString()
  DATABASE_URL_APP?: string;

  @IsOptional()
  @IsString()
  REDIS_URL = 'redis://localhost:6379';

  @IsString()
  @MinLength(16)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(16)
  JWT_REFRESH_SECRET!: string;

  @Matches(TTL_PATTERN)
  JWT_ACCESS_TTL = '15m';

  @Matches(TTL_PATTERN)
  JWT_REFRESH_TTL = '30d';

  /** CORS origin — read with getOrThrow at boot, so it is required here. */
  @IsString()
  @IsNotEmpty()
  WEB_URL!: string;

  @IsOptional()
  @IsString()
  DEFAULT_TIMEZONE = 'Asia/Tashkent';

  // ---------- File storage (MinIO / S3) ----------
  // Missing credentials used to fall back to '' and let the app boot, then fail
  // on every single upload at runtime. They are required now.

  @IsString()
  @IsNotEmpty()
  MINIO_ENDPOINT!: string;

  /**
   * Host the *browser* uses for presigned URLs. Inside Docker the API talks to
   * "minio", which resolves to nothing outside the network — a presigned URL
   * built from the internal endpoint simply does not open.
   */
  @IsOptional()
  @IsString()
  MINIO_PUBLIC_ENDPOINT?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  MINIO_PORT = 9000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  MINIO_PUBLIC_PORT?: number;

  @IsString()
  @IsNotEmpty()
  MINIO_BUCKET!: string;

  @IsString()
  @IsNotEmpty()
  MINIO_ROOT_USER!: string;

  @IsString()
  @IsNotEmpty()
  MINIO_ROOT_PASSWORD!: string;

  @IsBooleanString()
  MINIO_USE_SSL = 'false';

  @IsOptional()
  @IsBooleanString()
  MINIO_PUBLIC_USE_SSL?: string;

  // ---------- Optional integrations ----------

  @IsOptional()
  @IsString()
  SMS_PROVIDER_URL?: string;

  @IsOptional()
  @IsString()
  SMS_PROVIDER_TOKEN?: string;

  @IsOptional()
  @IsString()
  TELEGRAM_BOT_TOKEN?: string;

  /** Error tracking; without it errors only reach the container log. */
  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @IsOptional()
  @IsString()
  APP_VERSION?: string;

  @IsOptional()
  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
  LOG_LEVEL?: string;

  /** Optional today; the AI stage (roadmap 8) makes it required. */
  @IsOptional()
  @IsString()
  ANTHROPIC_API_KEY?: string;

  @IsOptional()
  @IsString()
  AI_MODEL_FAST?: string;

  @IsOptional()
  @IsString()
  AI_MODEL_SMART?: string;

  // ---------- Seed ----------

  @IsOptional()
  @IsString()
  SEED_SUPERADMIN_EMAIL?: string;

  @IsOptional()
  @IsString()
  SEED_SUPERADMIN_PASSWORD?: string;
}

/**
 * Rules that only make sense on a production box. Keeping them out of the
 * decorators lets developers run with short secrets and plain HTTP locally
 * while a real deployment cannot start misconfigured.
 */
function assertProductionHardening(env: EnvironmentVariables): void {
  const problems: string[] = [];

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    if (env[key].length < PRODUCTION_SECRET_MIN_LENGTH) {
      problems.push(`${key}: must be at least ${PRODUCTION_SECRET_MIN_LENGTH} characters`);
    }
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_ACCESS_SECRET: must differ from JWT_REFRESH_SECRET');
  }
  if (env.MINIO_USE_SSL !== 'true') {
    problems.push('MINIO_USE_SSL: must be true');
  }
  if (!env.WEB_URL.startsWith('https://')) {
    problems.push('WEB_URL: must start with https://');
  }

  if (problems.length > 0) {
    throw new Error(`Invalid production configuration — ${problems.join('; ')}`);
  }
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false, whitelist: true });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${details}`);
  }

  if (validated.NODE_ENV === 'production') assertProductionHardening(validated);
  return validated;
}

/** Public (browser-facing) MinIO endpoint, falling back to the internal one. */
export function publicStorageEndpoint(env: {
  MINIO_ENDPOINT: string;
  MINIO_PUBLIC_ENDPOINT?: string;
  MINIO_PORT: number;
  MINIO_PUBLIC_PORT?: number;
  MINIO_USE_SSL: string;
  MINIO_PUBLIC_USE_SSL?: string;
}): { endPoint: string; port: number; useSSL: boolean } {
  return {
    endPoint: env.MINIO_PUBLIC_ENDPOINT ?? env.MINIO_ENDPOINT,
    port: env.MINIO_PUBLIC_PORT ?? env.MINIO_PORT,
    useSSL: (env.MINIO_PUBLIC_USE_SSL ?? env.MINIO_USE_SSL) === 'true',
  };
}
