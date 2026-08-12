import { PartialType } from '@nestjs/mapped-types';
import {
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
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number;

  @IsOptional()
  @IsTiyin()
  cost?: string;

  @IsOptional()
  @IsString({ each: true })
  partsList?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
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
}
