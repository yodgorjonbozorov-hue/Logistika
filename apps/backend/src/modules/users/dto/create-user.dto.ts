import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserRole } from 'shared';

/** Roles a tenant may assign; SUPERADMIN is platform-only. */
export const TENANT_ROLES = [
  UserRole.OWNER,
  UserRole.LOGIST,
  UserRole.ACCOUNTANT,
  UserRole.DRIVER,
] as const;

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  fullName!: string;

  @ValidateIf((o: CreateUserDto) => !o.phone || !!o.email)
  @IsEmail()
  email?: string;

  @ValidateIf((o: CreateUserDto) => !o.email || !!o.phone)
  @Matches(/^\+?\d{9,15}$/)
  phone?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsIn(TENANT_ROLES)
  role!: UserRole;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(/^\+?\d{9,15}$/)
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsIn(TENANT_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
