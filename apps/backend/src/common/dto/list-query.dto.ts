import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from './pagination.dto';

export type SortDirection = 'asc' | 'desc';

/**
 * Pagination plus free-text search and an explicit sort (L-5).
 *
 * `search` is passed to Prisma as a value, never concatenated into SQL — the
 * driver parameterises it, so there is nothing to inject. It is length-capped
 * anyway: an unbounded LIKE pattern is a cheap way to make PostgreSQL work hard.
 */
export class ListQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: SortDirection = 'desc';
}

/**
 * Turns a client-supplied sort field into an order clause.
 *
 * The allow-list is the whole point: without it, `?sort=passwordHash` would
 * happily order by — and thereby leak the ordering of — a column the caller
 * must never see, and `?sort=` anything unindexed is a free table scan.
 */
export function orderBy<T extends string>(
  query: ListQueryDto,
  allowed: readonly T[],
  fallback: T,
): Record<string, SortDirection> {
  const field = (allowed as readonly string[]).includes(query.sort ?? '')
    ? (query.sort as T)
    : fallback;
  return { [field]: query.order };
}
