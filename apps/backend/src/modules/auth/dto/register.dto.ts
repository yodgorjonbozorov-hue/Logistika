import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Self-service sign-up. Creates the tenant and its first OWNER at once, so the
 * fields cover both. `companyId` is never accepted from the client — the tenant
 * is the one this request creates.
 */
export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  companyName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  fullName!: string;

  @IsEmail()
  @MaxLength(190)
  email!: string;

  @IsOptional()
  @Matches(/^\+?\d{9,15}$/)
  phone?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
