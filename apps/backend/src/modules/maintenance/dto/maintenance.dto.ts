import { PartialType } from '@nestjs/mapped-types';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { MaintenanceType } from 'shared';
import { IsTiyin } from '../../../common/dto/money';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateMaintenanceDto {
  @IsUUID()
  vehicleId!: string;

  @IsEnum(MaintenanceType)
  type!: MaintenanceType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number;

  @IsOptional()
  @IsTiyin()
  cost?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  partsList?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  serviceName?: string;

  @IsOptional()
  @IsDateString()
  serviceDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  nextServiceOdometer?: number;
}

export class UpdateMaintenanceDto extends PartialType(CreateMaintenanceDto) {}

export class ListMaintenanceDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsEnum(MaintenanceType)
  type?: MaintenanceType;
}
