import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { MaintenanceType } from 'shared';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListMaintenanceDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}

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
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometer?: number;

  /** Money is tiyin as a decimal string — never a float (CLAUDE.md). */
  @IsOptional()
  @IsNumberString()
  cost?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  serviceName?: string;

  @IsOptional()
  @IsISO8601()
  serviceDate?: string;

  /** Odometer at which the next service falls due — drives the W-10 alert. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  nextServiceOdometer?: number;
}

export class UpdateMaintenanceDto extends PartialType(CreateMaintenanceDto) {}
