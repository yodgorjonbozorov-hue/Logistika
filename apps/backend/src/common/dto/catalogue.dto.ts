import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationDto } from './pagination.dto';

/**
 * Listing for the catalogues that are soft-deleted: drivers, vehicles, clients.
 *
 * Retiring a record used to leave it in every list and every picker, so a
 * driver who had left the company could still be put on tomorrow's trip. The
 * default is now the working set; the archive is asked for explicitly, because
 * the history has to stay reachable — that is the whole point of retiring a
 * record instead of deleting it.
 */
export class CatalogueListDto extends PaginationDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeInactive = false;

  /** Prisma filter: undefined when the archive was asked for. */
  get activeFilter(): true | undefined {
    return this.includeInactive ? undefined : true;
  }
}
