import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsNotEmptyObject,
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

  /**
   * `@ValidateNested` alone silently passes when the object is missing, and the
   * service then dereferences it — a request without `owner` produced a 500
   * instead of a 400. `@IsNotEmptyObject` makes the requirement explicit.
   */
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => AdminCreateOwnerDto)
  owner!: AdminCreateOwnerDto;
}

/** Typing the company's name back is what makes the delete deliberate. */
export class AdminDeleteCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  confirmName!: string;
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
