import { IsString, Length } from 'class-validator';
import { IsPhone, NormalizePhone } from '../../../common/phone';

export class RequestCodeDto {
  @NormalizePhone()
  @IsPhone()
  phone!: string;
}

export class VerifyCodeDto {
  @NormalizePhone()
  @IsPhone()
  phone!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
