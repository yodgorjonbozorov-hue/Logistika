import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { LOCALES, type Locale } from 'shared';

/**
 * The hard ceiling here is deliberately generous compared with
 * `AI_MAX_PROMPT_CHARS`: this one stops a megabyte reaching the validator at
 * all, and the configured limit — which a deployment can tighten without a
 * release — decides what is actually answered.
 */
export const ABSOLUTE_MAX_PROMPT_CHARS = 2000;

export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(ABSOLUTE_MAX_PROMPT_CHARS)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  question!: string;

  /** Answer language. Falls back to the Accept-Language header, then uz-latn. */
  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}
