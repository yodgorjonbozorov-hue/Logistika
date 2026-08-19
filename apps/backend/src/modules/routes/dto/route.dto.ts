import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class CreateRouteDto {
  /** Unique within the company — it is the label every report groups by. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  originName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  destinationName!: string;

  /**
   * Kilometres with at most one decimal, as a string.
   *
   * A JSON number would arrive as a double and 1234.5 does not survive that
   * exactly; the column is DECIMAL(9,1) and the value is parsed textually.
   */
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d)?$/, { message: 'plannedDistanceKm must be km with at most 1 decimal' })
  plannedDistanceKm?: string;
}

export class UpdateRouteDto extends PartialType(CreateRouteDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListRoutesDto extends ListQueryDto {
  /**
   * Hides deactivated routes. A query string carries `true`, not a boolean, so
   * the value is converted before `@IsBoolean` sees it — otherwise the filter
   * would be a 400 in every browser that sent it.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  onlyActive?: boolean;
}
