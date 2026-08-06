import { IsString, Length, Matches } from 'class-validator';

export class RequestCodeDto {
  @Matches(/^\+?\d{9,15}$/)
  phone!: string;
}

export class VerifyCodeDto {
  @Matches(/^\+?\d{9,15}$/)
  phone!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
