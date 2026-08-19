import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListFuelLogsDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class CreateFuelLogDto {
  @IsUUID()
  vehicleId!: string;

  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  /** Litres, up to two decimals. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  liters!: number;

  /** Money is tiyin as a decimal string — never a float (CLAUDE.md). */
  @IsOptional()
  @IsNumberString()
  pricePerLiter?: string;

  @IsOptional()
  @IsNumberString()
  totalAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  stationName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometer?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptPhoto?: string;

  @IsISO8601()
  refuelTime!: string;
}

export class UpdateFuelLogDto extends PartialType(CreateFuelLogDto) {}

export class FuelControlDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
