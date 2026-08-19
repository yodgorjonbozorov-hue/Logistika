import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsPositiveTiyin, IsTiyin } from '../../../common/dto/money';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateFuelLogDto {
  @IsUUID()
  vehicleId!: string;

  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  /**
   * Litres with at most two decimals, as a STRING.
   *
   * A JSON number is a double: 302.55 is not representable exactly, and litres
   * multiply into both the fuel cost and the consumption-versus-norm figure
   * that flags suspected theft. Parsed textually, like money.
   */
  @Matches(/^\d{1,6}(\.\d{1,2})?$/, { message: 'liters must be a positive amount, max 2 decimals' })
  liters!: string;

  /** Tiyin per litre. */
  @IsOptional()
  @IsTiyin()
  pricePerLiter?: string;

  /** Total paid, in tiyin. Derived from liters × pricePerLiter when omitted. */
  @IsOptional()
  @IsPositiveTiyin()
  totalAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stationName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometer?: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptPhoto?: string;

  @IsDateString()
  refuelTime!: string;

  /** Idempotency key — a retried POST returns the first row, never a second. */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_:-]{8,64}$/, {
    message: 'clientTxId must be 8-64 chars of [A-Za-z0-9_:-]',
  })
  clientTxId?: string;
}

export class UpdateFuelLogDto extends PartialType(CreateFuelLogDto) {}

export class ListFuelLogsDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  tripId?: string;
}
