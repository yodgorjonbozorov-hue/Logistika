import { plainToInstance, Type } from 'class-transformer';
import {
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
  @MinLength(16)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(16)
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

  // ---------- File storage (MinIO / S3) ----------
  // Every key the app reads must be declared here: Nest replaces the whole
  // config with this validated instance, so an undeclared variable is dropped
  // and reaches the service as `undefined`.

  @IsOptional()
  @IsString()
  MINIO_ENDPOINT = 'localhost';

  @IsOptional()
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

  @IsOptional()
  @IsString()
  MINIO_USE_SSL = 'false';

  // ---------- SMS (driver login codes) ----------

  @IsOptional()
  @IsString()
  SMS_PROVIDER_URL = '';

  @IsOptional()
  @IsString()
  SMS_PROVIDER_TOKEN = '';
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
  return validated;
}
