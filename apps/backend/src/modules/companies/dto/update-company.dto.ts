import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { LOCALES } from 'shared';

/** Zones a company in this market realistically operates in (TZ §5 — UTC storage). */
export const SUPPORTED_TIMEZONES = [
  'Asia/Tashkent',
  'Asia/Almaty',
  'Europe/Moscow',
  'Asia/Bishkek',
  'Asia/Dushanbe',
  'UTC',
] as const;

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(190)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo?: string;

  /** Language reports, AI explanations and the daily digest are written in. */
  @IsOptional()
  @IsIn([...LOCALES])
  locale?: string;

  /** Zone the digest time is read in; storage stays UTC everywhere. */
  @IsOptional()
  @IsIn([...SUPPORTED_TIMEZONES])
  timezone?: string;
}
