import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPayload } from '../interceptors/api-response.interceptor';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export function paginated<T>(data: T[], dto: PaginationDto, total: number): ApiPayload<T[]> {
  return new ApiPayload(data, { pagination: { page: dto.page, limit: dto.limit, total } });
}
