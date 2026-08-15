import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VehicleType } from 'shared';
import { IsTiyin } from '../../../common/dto/money';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plateNumber!: string;

  @IsOptional()
  @IsEnum(VehicleType)
  type?: VehicleType;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  vin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  fuelType?: string;

  /** l/100km — Decimal, not money. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(200)
  fuelNormPer100km?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tankCapacity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentOdometer?: number;

  /** Purchase price in tiyin — the numerator of the depreciation formula (TZ §6). */
  @IsOptional()
  @IsTiyin()
  purchasePrice?: string;

  /** Planned lifetime mileage in km — the denominator of the same formula. */
  @IsOptional()
  @IsInt()
  @Min(1)
  plannedTotalKm?: number;

  @IsOptional()
  @IsDateString()
  insuranceExpiry?: string;

  @IsOptional()
  @IsDateString()
  techInspectionExpiry?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  nextServiceOdometer?: number;
}

export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
