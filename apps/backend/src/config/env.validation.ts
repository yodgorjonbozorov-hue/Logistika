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
