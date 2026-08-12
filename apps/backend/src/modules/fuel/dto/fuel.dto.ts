import { PartialType } from '@nestjs/mapped-types';
import {
  IsDateString,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { IsTiyin } from '../../../common/dto/money';
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

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
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
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptPhoto?: string;

  @IsDateString()
  refuelTime!: string;
}

export class UpdateFuelLogDto extends PartialType(CreateFuelLogDto) {}

export class ListFuelDto extends PaginationDto {
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
}
