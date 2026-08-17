import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Currency } from 'shared';

export class UpsertExchangeRateDto {
  @IsEnum(Currency)
  currency!: Currency;

  @Type(() => Date)
  @IsDate()
  date!: Date;

  /** Decimal as a string: a float here would round the rate before it is used. */
  @Matches(/^\d{1,12}(\.\d{1,6})?$/)
  rateToUzs!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  source?: string;
}

export class ListExchangeRatesDto {
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}
