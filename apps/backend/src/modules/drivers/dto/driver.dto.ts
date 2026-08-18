import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SalaryType } from 'shared';
import { IsTiyin } from '../../../common/dto/money';
import { IsPhone, NormalizePhone } from '../../../common/phone';

export class CreateDriverDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  fullName!: string;

  @IsOptional()
  @NormalizePhone()
  @IsPhone()
  phone?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  passport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  licenseNumber?: string;

  @IsOptional()
  @IsDateString()
  licenseExpiry?: string;

  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @IsOptional()
  @IsEnum(SalaryType)
  salaryType?: SalaryType;

  /** FIXED → tiyin/oy; PER_KM → tiyin/km; PERCENT → bazis punkt (1% = 100). */
  @IsOptional()
  @IsTiyin()
  salaryValue?: string;
}

export class UpdateDriverDto extends PartialType(CreateDriverDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
