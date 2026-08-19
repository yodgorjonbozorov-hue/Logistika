import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const TTL_PATTERN = /^\d+(s|m|h|d)$/;

/** Placeholders shipped in .env.example — never acceptable in production. */
const FORBIDDEN_PRODUCTION_SECRETS = [
  'change-me',
  'change-me-access-secret',
  'change-me-refresh-secret',
  'change-me-minio',
  'secret',
  'changeme',
];

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0' || value === undefined || value === '') return false;
  return value;
};

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  API_PORT = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  REDIS_URL = 'redis://localhost:6379';

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  @Matches(TTL_PATTERN)
  JWT_ACCESS_TTL = '15m';

  @Matches(TTL_PATTERN)
  JWT_REFRESH_TTL = '30d';

  @IsOptional()
  @IsString()
  WEB_URL = 'http://localhost:5173';

  @IsOptional()
  @IsString()
  DEFAULT_TIMEZONE = 'Asia/Tashkent';

  // ---------- Reverse proxy ----------

  /**
   * Number of trusted proxy hops in front of the API (nginx = 1).
   * MUST stay 0 when the app is reachable directly: with `trust proxy` on, a
   * client can forge X-Forwarded-For and walk straight past the IP rate limits.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY = 0;

  // ---------- Rate limiting ----------

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_TTL_SECONDS = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_MAX = 300;

  // ---------- Payload limits ----------

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  MAX_UPLOAD_MB = 15;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  MAX_JSON_BODY_MB = 2;

  // ---------- Object storage ----------

  @IsOptional()
  @IsString()
  MINIO_ENDPOINT = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  MINIO_PORT = 9000;

  @IsOptional()
  @IsString()
  MINIO_ROOT_USER = 'truckcontrol';

  @IsOptional()
  @IsString()
  MINIO_ROOT_PASSWORD = '';

  @IsOptional()
  @IsString()
  MINIO_BUCKET = 'truckcontrol';

  @Transform(toBoolean)
  @IsBoolean()
  MINIO_USE_SSL = false;

  // ---------- SMS ----------

  @IsOptional()
  @IsUrl({ require_tld: false })
  SMS_PROVIDER_URL?: string;

  @IsOptional()
  @IsString()
  SMS_PROVIDER_TOKEN?: string;
}

/**
 * Extra rules that only bite in production. Keeping them out of the decorators
 * lets development and tests run with the sample values while a real deployment
 * refuses to boot on a placeholder secret (M-4 / secrets-in-source hardening).
 */
function assertProductionSafety(env: EnvironmentVariables): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  const secrets: Array<[string, string]> = [
    ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
  ];
  for (const [name, value] of secrets) {
    if (FORBIDDEN_PRODUCTION_SECRETS.some((weak) => value?.toLowerCase().includes(weak))) {
      problems.push(`${name}: still set to a sample/placeholder value`);
    }
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_REFRESH_SECRET: must differ from JWT_ACCESS_SECRET');
  }
  if (!env.MINIO_ROOT_PASSWORD || env.MINIO_ROOT_PASSWORD.length < 12) {
    problems.push('MINIO_ROOT_PASSWORD: required (min 12 chars) in production');
  }
  if (FORBIDDEN_PRODUCTION_SECRETS.includes(env.MINIO_ROOT_PASSWORD.toLowerCase())) {
    problems.push('MINIO_ROOT_PASSWORD: still set to a sample/placeholder value');
  }
  if (!env.WEB_URL.startsWith('https://')) {
    problems.push('WEB_URL: must be an https:// origin in production');
  }
  if (env.DATABASE_URL.includes('change-me')) {
    problems.push('DATABASE_URL: still contains the sample password');
  }
  return problems;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false, whitelist: true });
  const problems = errors.map(
    (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
  );
  problems.push(...assertProductionSafety(validated));

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration — ${problems.join('; ')}`);
  }
  return validated;
}
