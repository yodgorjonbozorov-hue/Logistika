import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
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

  /**
   * Whether the response should carry the total row count.
   *
   * Default true, because a page that shows "1–20 of 347" needs it. A count on
   * a large table is a scan, though, and the tables that grow without bound
   * pay it on every page — so a client that only needs "is there more" can
   * turn it off and read `hasMore`.
   */
  @IsOptional()
  @Transform(({ value }) => !(value === false || value === 'false' || value === '0'))
  @IsBoolean()
  withTotal = true;
}

/**
 * How many rows to step over for the requested page.
 *
 * Deliberately a function and not a `get skip()` on the DTO: `IntersectionType`
 * and friends rebuild the class from its *own* properties, and a prototype
 * accessor is not one — so on every DTO composed that way (`ListTripsDto`,
 * `ListEventsDto`, `ListLedgerDto`, `ListAuditLogsDto`) the getter silently
 * disappeared and `skip` arrived at Prisma as `undefined`. Prisma ignores an
 * undefined `skip`, so page 2, 3 and 4 all quietly returned page 1. Nothing
 * threw, and the totals looked right, which is why it survived this long.
 */
export function skipOf(dto: PaginationDto): number {
  return (dto.page - 1) * dto.limit;
}

export interface Page<T> {
  data: T[];
  total: number | null;
  hasMore: boolean;
}

/**
 * Runs a paginated read, counting only when the caller asked for a total.
 *
 * `hasMore` comes from fetching one row beyond the page rather than from the
 * count, so it is correct even when the count was skipped — and it is what a
 * "next page" button actually needs.
 */
export async function readPage<T>(
  dto: PaginationDto,
  find: (args: { skip: number; take: number }) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<Page<T>> {
  const [rows, total] = await Promise.all([
    find({ skip: skipOf(dto), take: dto.limit + 1 }),
    dto.withTotal ? count() : Promise.resolve(null),
  ]);
  const hasMore = rows.length > dto.limit;
  return { data: hasMore ? rows.slice(0, dto.limit) : rows, total, hasMore };
}

export function paginated<T>(page: Page<T>, dto: PaginationDto): ApiPayload<T[]> {
  return new ApiPayload(page.data, {
    pagination: { page: dto.page, limit: dto.limit, total: page.total, hasMore: page.hasMore },
  });
}
