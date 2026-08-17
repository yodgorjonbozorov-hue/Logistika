import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  /**
   * Optional: browsers send the token in the httpOnly `tc_rt` cookie, native
   * clients keep sending it in the body. One of the two must be present, which
   * the handler checks (a DTO cannot see cookies).
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
