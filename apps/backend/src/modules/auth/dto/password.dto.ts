import { IsString, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/dto/password';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsStrongPassword()
  newPassword!: string;
}

/** Email or phone — whichever the user signs in with. */
export class ForgotPasswordDto {
  @IsString()
  @MinLength(3)
  identifier!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsStrongPassword()
  newPassword!: string;
}
