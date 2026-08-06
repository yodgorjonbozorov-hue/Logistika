import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  /** Email (office staff) or phone number (drivers). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(190)
  identifier!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
