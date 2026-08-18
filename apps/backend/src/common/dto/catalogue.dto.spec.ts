import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CatalogueListDto } from './catalogue.dto';

const parse = (query: Record<string, unknown>) => plainToInstance(CatalogueListDto, query);

describe('CatalogueListDto', () => {
  it('defaults to the working set', async () => {
    const dto = parse({});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.includeInactive).toBe(false);
    expect(dto.activeFilter).toBe(true);
  });

  it.each(['true', '1', true])('treats %p as a request for the archive', async (value) => {
    // Query strings carry text, so the raw "true" has to survive validation as
    // a boolean rather than being rejected.
    const dto = parse({ includeInactive: value });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.activeFilter).toBeUndefined();
  });

  it.each(['false', '0', 'yes', ''])('treats %p as the working set', async (value) => {
    const dto = parse({ includeInactive: value });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.activeFilter).toBe(true);
  });

  it('still paginates', () => {
    const dto = parse({ page: 3, limit: 20 });
    expect(dto.skip).toBe(40);
  });
});
