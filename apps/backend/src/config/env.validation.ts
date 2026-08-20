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
  'replace_me',
  'replace-with',
  'placeholder',
  'example',
];

/**
 * Hostnames that mean "this was never filled in" when they appear in a URL the
 * outside world has to reach. Loopback is deliberately NOT in this list for
 * DATABASE_URL / REDIS_URL / MINIO_ENDPOINT: a datastore reachable only over
 * loopback is the safest way to run one, and failing to boot on it would
 * punish the better deployment.
 */
const PLACEHOLDER_HOSTS = ['example.com', 'example.org', 'replace_me', 'replace-me', 'yourdomain'];

/** True for a host the rest of the network cannot reach. */
function isLoopback(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, '');
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1' || bare.startsWith('127.');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

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

  // ---------- AI assistant (TZ §8) ----------

  /** `mock` needs no credentials and no network; it is the safe default. */
  @IsIn(['mock', 'anthropic'])
  AI_PROVIDER = 'mock';

  /** Backend-only. Never reaches a browser — the web app talks to /ai/*. */
  @IsOptional()
  @IsString()
  AI_API_KEY = '';

  @IsOptional()
  @IsString()
  AI_MODEL = 'claude-opus-5';

  /** A question must not hold a request open longer than this. */
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(60_000)
  AI_TIMEOUT_MS = 15_000;

  /** Longest question accepted. Cost, and injection surface. */
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(2000)
  AI_MAX_PROMPT_CHARS = 500;

  /** Longest answer returned to the client, in characters. */
  @Type(() => Number)
  @IsInt()
  @Min(200)
  @Max(8000)
  AI_MAX_ANSWER_CHARS = 1200;

  /** Token ceiling for the provider call. */
  @Type(() => Number)
  @IsInt()
  @Min(256)
  @Max(8192)
  AI_MAX_ANSWER_TOKENS = 2048;

  /** Kill switch: the endpoints stay mounted and answer deterministically. */
  @Transform(toBoolean)
  @IsBoolean()
  AI_ENABLED = true;

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
function assertProductionSafety(env: EnvironmentVariables, raw: Record<string, unknown>): string[] {
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
  // The browser has to resolve this one, so loopback and the documentation
  // domains mean the template was never filled in.
  const webHost = hostOf(env.WEB_URL).toLowerCase();
  if (isLoopback(webHost) || PLACEHOLDER_HOSTS.some((bad) => webHost.includes(bad))) {
    problems.push(`WEB_URL: "${webHost || env.WEB_URL}" is a placeholder, not a real domain`);
  }
  if (FORBIDDEN_PRODUCTION_SECRETS.some((weak) => env.DATABASE_URL.toLowerCase().includes(weak))) {
    problems.push('DATABASE_URL: still contains a sample/placeholder credential');
  }

  // Credentials and file bytes travelling in clear text to a storage node on
  // another host. Over loopback there is no network to intercept, so that case
  // is allowed — it is how the single-server deployment runs.
  const storageHost = env.MINIO_ENDPOINT.toLowerCase();
  if (!env.MINIO_USE_SSL && !isLoopback(storageHost)) {
    problems.push(
      `MINIO_USE_SSL: must be true when MINIO_ENDPOINT ("${storageHost}") is not loopback — ` +
        'the access key would cross the network in clear text',
    );
  }
  if (PLACEHOLDER_HOSTS.some((bad) => storageHost.includes(bad))) {
    problems.push(`MINIO_ENDPOINT: "${storageHost}" is a placeholder, not a real host`);
  }

  // Redis holds refresh-token families and every rate-limit counter. Reachable
  // over the network it needs a password; over loopback it does not.
  const redisHost = hostOf(env.REDIS_URL);
  const redisHasAuth = /^rediss?:\/\/[^@/]+@/.test(env.REDIS_URL);
  if (redisHost && !isLoopback(redisHost) && !redisHasAuth) {
    problems.push('REDIS_URL: a non-loopback Redis must carry credentials');
  }

  // TRUST_PROXY has no safe default in production: 0 behind nginx makes every
  // request look like it came from the proxy, so one client's flood throttles
  // everybody, while a non-zero value with no proxy in front lets a client
  // forge X-Forwarded-For and walk past the limits entirely. Only the operator
  // knows which it is, so production has to say so explicitly — either value is
  // accepted, silence is not.
  if (raw.TRUST_PROXY === undefined || raw.TRUST_PROXY === '') {
    problems.push(
      'TRUST_PROXY: must be set explicitly in production (1 behind a single ' +
        'reverse proxy, 0 when the API is exposed directly)',
    );
  }
  // Selecting a real provider without a key would run every question through
  // the deterministic fallback while the deployment believed it had an
  // assistant. Fail at boot instead.
  if (env.AI_PROVIDER !== 'mock' && !env.AI_API_KEY) {
    problems.push(`AI_API_KEY: required when AI_PROVIDER is "${env.AI_PROVIDER}"`);
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
  problems.push(...assertProductionSafety(validated, config));

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration — ${problems.join('; ')}`);
  }
  return validated;
}
