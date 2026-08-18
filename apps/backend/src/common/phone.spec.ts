import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IsPhone, NormalizePhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['+998901234567', '+998901234567'],
    ['998901234567', '+998901234567'],
    ['901234567', '+998901234567'],
    ['8901234567', '+998901234567'],
    ['+998 90 123 45 67', '+998901234567'],
    ['(90) 123-45-67', '+998901234567'],
    ['  901234567  ', '+998901234567'],
  ])('reads %p as %p', (input, expected) => {
    // Four ways of writing one number used to be four accounts: the login
    // lookup is an exact match on a unique column.
    expect(normalizePhone(input)).toBe(expected);
  });

  it('keeps a foreign number as it was written', () => {
    // Assuming +998 for a Kazakh driver would turn a working number into a
    // wrong one that belongs to somebody else.
    expect(normalizePhone('+77012345678')).toBe('+77012345678');
    expect(normalizePhone('+7 701 234 56 78')).toBe('+77012345678');
  });

  it('leaves an empty value alone', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
  });

  it('does not invent digits for text', () => {
    expect(normalizePhone('telefon yoq')).toBe('telefon yoq');
  });

  it('is idempotent', () => {
    // It runs on every write; normalising twice must not change the answer.
    const once = normalizePhone('901234567');
    expect(normalizePhone(once)).toBe(once);
  });
});

class Contact {
  @NormalizePhone()
  @IsPhone()
  phone!: string;
}

const parse = async (phone: unknown) => {
  const dto = plainToInstance(Contact, { phone });
  return { dto, errors: await validate(dto) };
};

describe('the phone decorators together', () => {
  it('normalises before validating, so a typed number passes', async () => {
    const { dto, errors } = await parse('90 123 45 67');
    expect(errors).toHaveLength(0);
    expect(dto.phone).toBe('+998901234567');
  });

  it('refuses text, and says what a number looks like', async () => {
    const { errors } = await parse('telefon yoq');
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0]!.constraints ?? {}).join()).toContain('+998901234567');
  });

  it('refuses a number too short to be one', async () => {
    expect((await parse('12345')).errors).toHaveLength(1);
  });

  it('refuses a number too long to be one', async () => {
    expect((await parse('+1234567890123456')).errors).toHaveLength(1);
  });

  it('leaves a non-string for the type validators to reject', async () => {
    const { dto, errors } = await parse(42);
    expect(dto.phone).toBe(42 as unknown as string);
    expect(errors).toHaveLength(1);
  });
});
