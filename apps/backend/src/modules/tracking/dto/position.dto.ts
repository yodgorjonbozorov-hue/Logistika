import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDate,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PositionDto {
  @IsUUID()
  tripId!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(300)
  speed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsDateString()
  recordedAt!: string;
}

export class PositionBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PositionDto)
  positions!: PositionDto[];
}

/**
 * Route history window (H-8).
 *
 * `from`/`to` used to be unbounded strings: a single request could ask for a
 * whole year of 5-second GPS fixes and stream millions of rows into memory.
 * The window is now capped, validated, and paged with a hard `take`.
 */
export const MAX_HISTORY_RANGE_DAYS = 31;
export const MAX_HISTORY_POINTS = 5000;

export class TrackHistoryDto {
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @Type(() => Date)
  @IsDate()
  to!: Date;

  /** Opaque forward cursor: the `recordedAt` of the last point already seen. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  after?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_HISTORY_POINTS)
  limit: number = 1000;
}
