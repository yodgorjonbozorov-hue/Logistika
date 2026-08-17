import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

/**
 * A validated date range.
 *
 * `@Type(() => Date)` alone is not validation: an unparseable string becomes an
 * `Invalid Date`, which sails through to Prisma and comes back as a raw 500.
 * `@IsDate()` is what rejects it with a 400 and a field-level message.
 */
export class DateRangeDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

/** Same range, but both ends are required (history queries need a window). */
export class RequiredDateRangeDto {
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @Type(() => Date)
  @IsDate()
  to!: Date;
}
