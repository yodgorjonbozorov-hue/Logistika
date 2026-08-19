import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefreshDto {
  /**
   * Optional: browsers send the token as an httpOnly cookie instead (H-16),
   * native clients still put it in the body. The controller requires exactly
   * one of the two to be present.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
