import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPayload } from '../interceptors/api-response.interceptor';

/** Deep offsets make PostgreSQL scan and discard everything before them, so the
 *  page number is capped too — `?page=999999999` is a scan, not a query (M-7). */
const MAX_PAGE = 10_000;

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
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
