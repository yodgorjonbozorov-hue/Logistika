import { PartialType } from '@nestjs/mapped-types';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsTiyin } from '../../../common/dto/money';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { resolveFrom, resolveTo } from '../../finance/dto/finance.dto';

export class CreateFuelLogDto {
  @IsUUID()
  vehicleId!: string;

  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(2000)
  liters!: number;

  @IsOptional()
  @IsTiyin()
  pricePerLiter?: string;

  @IsOptional()
  @IsTiyin()
  totalAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stationName?: string;

  @IsOptional()
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
}

export class UpdateFuelLogDto extends PartialType(CreateFuelLogDto) {}

export class ListFuelLogsDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  private cachedFrom?: Date;
  private cachedTo?: Date;

  get fromDate(): Date {
    this.cachedFrom ??= resolveFrom(this.from);
    return this.cachedFrom;
  }

  get toDate(): Date {
    this.cachedTo ??= resolveTo(this.to);
    return this.cachedTo;
  }
}
