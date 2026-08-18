import { IntersectionType } from '@nestjs/mapped-types';
import { plainToInstance } from 'class-transformer';
import { PaginationDto, readPage } from './pagination.dto';

const dto = (query: Record<string, unknown> = {}) => plainToInstance(PaginationDto, query);

describe('PaginationDto.withTotal', () => {
  it('asks for the total by default', () => {
    // A page that shows "1–20 of 347" needs it; most screens do.
    expect(dto().withTotal).toBe(true);
  });

  it.each(['false', '0', false])('treats %p as a request to skip the count', (value) => {
    expect(dto({ withTotal: value }).withTotal).toBe(false);
  });

  it.each(['true', '1', true])('treats %p as a request for the count', (value) => {
    expect(dto({ withTotal: value }).withTotal).toBe(true);
  });
});

describe('readPage', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

  function setup(available: number) {
    const find = jest.fn(({ take }: { skip: number; take: number }) =>
      Promise.resolve(rows(Math.min(available, take))),
    );
    const count = jest.fn().mockResolvedValue(available);
    return { find, count };
  }

  it('reads one row beyond the page to answer "is there more"', async () => {
    const { find, count } = setup(100);

    await readPage(dto({ page: 2, limit: 20 }), find, count);

    expect(find).toHaveBeenCalledWith({ skip: 20, take: 21 });
  });

  it('steps over earlier pages on a DTO composed with IntersectionType', async () => {
    // `skip` used to be a `get skip()` on the DTO, and IntersectionType rebuilds
    // a class from its own properties only — so on every composed list DTO the
    // getter vanished, Prisma got `skip: undefined`, and page 5 quietly served
    // page 1. Nothing threw; the totals even looked right.
    class Composed extends IntersectionType(PaginationDto, class Extra {}) {}
    const { find, count } = setup(100);

    await readPage(plainToInstance(Composed, { page: 5, limit: 20 }), find, count);

    expect(find).toHaveBeenCalledWith({ skip: 80, take: 21 });
  });

  it('does not hand the extra row to the caller', async () => {
    const { find, count } = setup(100);

    const page = await readPage(dto({ limit: 20 }), find, count);

    expect(page.data).toHaveLength(20);
    expect(page.hasMore).toBe(true);
  });

  it('reports the last page as the last page', async () => {
    const { find, count } = setup(5);

    const page = await readPage(dto({ limit: 20 }), find, count);

    expect(page.data).toHaveLength(5);
    expect(page.hasMore).toBe(false);
  });

  it('reports a full page with nothing after it correctly', async () => {
    const { find, count } = setup(20);

    // The boundary that an off-by-one gets wrong: exactly one full page.
    const page = await readPage(dto({ limit: 20 }), find, count);
    expect(page.hasMore).toBe(false);
  });

  it('counts when the caller wants a total', async () => {
    const { find, count } = setup(100);

    const page = await readPage(dto({ limit: 20 }), find, count);

    expect(count).toHaveBeenCalled();
    expect(page.total).toBe(100);
  });

  it('skips the count when the caller does not', async () => {
    const { find, count } = setup(100);

    const page = await readPage(dto({ limit: 20, withTotal: 'false' }), find, count);

    // Counting a large table is a scan; a "next page" button never needed it.
    expect(count).not.toHaveBeenCalled();
    expect(page.total).toBeNull();
    expect(page.hasMore).toBe(true);
  });

  it('still knows there is more when it skipped the count', async () => {
    const { find, count } = setup(21);

    const page = await readPage(dto({ limit: 20, withTotal: 'false' }), find, count);

    expect(page.hasMore).toBe(true);
    expect(page.total).toBeNull();
  });
});
