import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { SalaryType } from 'shared';
import { IsTiyin } from '../../../common/dto/money';

export class CreateDriverDto {
  /**
   * The login account this driver signs in with. Without it the driver app is
   * dead weight: /trips/my, /events/batch and /tracking/positions all resolve
   * the driver profile through `Driver.userId` (C-1).
   * The referenced user must belong to the same company and have role DRIVER.
   * `null` unlinks the login account without deleting the driver record.
   */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  userId?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  fullName!: string;

  @IsOptional()
  @Matches(/^\+?\d{9,15}$/)
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
