import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AdminCreateOwnerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class AdminCreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tariffPlan?: string;

  @IsOptional()
  @IsDateString()
  subscriptionUntil?: string;

  @ValidateNested()
  @Type(() => AdminCreateOwnerDto)
  owner!: AdminCreateOwnerDto;
}

export class AdminUpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tariffPlan?: string;

  @IsOptional()
  @IsDateString()
  subscriptionUntil?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
