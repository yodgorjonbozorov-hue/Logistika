import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ValidateIf,
  MinLength,
  IsIn,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Currency, TripStatus } from 'shared';
import { IsTiyin } from '../../../common/dto/money';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateTripDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  trailerId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(190)
  cargoName?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cargoWeight?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cargoVolume?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  loadingAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  loadingLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  loadingLng?: number;

  @IsOptional()
  @IsDateString()
  loadingDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  unloadingAddress?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  unloadingLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  unloadingLng?: number;

  @IsOptional()
  @IsDateString()
  unloadingDate?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  plannedDistanceKm?: number;

  @IsOptional()
  @IsTiyin()
  agreedPrice?: string;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsTiyin()
  driverAdvance?: string;
}

export class UpdateTripDto extends PartialType(CreateTripDto) {}

export class AssignTripDto {
  @IsUUID()
  vehicleId!: string;

  @IsOptional()
  @IsUUID()
  trailerId?: string;

  @IsUUID()
  driverId!: string;
}

export class StartTripDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  startOdometer?: number;
}

export class CompleteTripDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  endOdometer?: number;
}

export class ListTripsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(TripStatus)
  status?: TripStatus;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @Type(() => Date)
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  to?: Date;
}

/**
 * Ending a trip in something other than success.
 *
 * The reason is mandatory and has a minimum length on purpose: "x" as an
 * explanation is the same as no explanation when somebody reviews a loss-making
 * month six weeks later.
 */
export class FinishTripDto {
  @IsIn(['PARTIALLY_DELIVERED', 'RETURNED', 'FAILED', 'CANCELLED'])
  status!: 'PARTIALLY_DELIVERED' | 'RETURNED' | 'FAILED' | 'CANCELLED';

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  /** Required for PARTIALLY_DELIVERED: the part that actually arrived. */
  @ValidateIf((dto: FinishTripDto) => dto.status === 'PARTIALLY_DELIVERED')
  @IsTiyin()
  deliveredAmount?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  endOdometer?: number;
}
