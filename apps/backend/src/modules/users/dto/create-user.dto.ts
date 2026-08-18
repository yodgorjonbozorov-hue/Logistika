import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { UserRole } from 'shared';
import { IsStrongPassword } from '../../../common/dto/password';
import { IsPhone, NormalizePhone } from '../../../common/phone';

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
  @NormalizePhone()
  @IsPhone()
  phone?: string;

  @IsString()
  @IsStrongPassword()
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
  @NormalizePhone()
  @IsPhone()
  phone?: string;

  @IsOptional()
  @IsString()
  @IsStrongPassword()
  password?: string;

  @IsOptional()
  @IsIn(TENANT_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
