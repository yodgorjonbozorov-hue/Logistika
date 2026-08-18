import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateExpenseDto, CreateIncomeDto } from '../../modules/expenses/dto/expense.dto';
import { CreateTripDto } from '../../modules/trips/dto/trip.dto';

/**
 * Money arriving from a client (TASK-5.3).
 *
 * `IsTiyin` accepted `0`, so a zero-so'm expense was a valid request: a row
 * that means nothing, costs nothing and quietly widens every average. The
 * ledger already refuses non-positive entries, and the web form says so at the
 * field — the DTO has to agree with both, because a client rule the API does
 * not share is a rule that is not enforced.
 */
const messagesFor = (dto: object): string[] =>
  validateSync(dto, { whitelist: true }).flatMap((error) => Object.values(error.constraints ?? {}));

const expense = (amount: string) =>
  messagesFor(
    plainToInstance(CreateExpenseDto, {
      category: 'FUEL',
      amount,
      expenseDate: new Date().toISOString(),
    }),
  );

describe('amount validation', () => {
  it('accepts an ordinary amount', () => {
    expect(expense('125000000')).toEqual([]);
  });

  it('accepts one tiyin', () => {
    expect(expense('1')).toEqual([]);
  });

  it('refuses zero', () => {
    expect(expense('0')).toContain('must be greater than zero');
  });

  it('refuses a string of zeroes', () => {
    // "000" is digits and it is still nothing.
    expect(expense('000')).toContain('must be greater than zero');
  });

  it('still refuses anything that is not digits', () => {
    expect(expense('12.5').length).toBeGreaterThan(0);
    expect(expense('-5').length).toBeGreaterThan(0);
    expect(expense('1e9').length).toBeGreaterThan(0);
  });

  it('accepts an amount far past Number.MAX_SAFE_INTEGER', () => {
    // Money is BigInt end to end; the validator must not quietly cap it.
    expect(expense('999999999999999999')).toEqual([]);
  });

  it('applies to an income as well', () => {
    expect(messagesFor(plainToInstance(CreateIncomeDto, { amount: '0' }))).toContain(
      'must be greater than zero',
    );
  });

  it("applies to a trip's agreed price", () => {
    expect(messagesFor(plainToInstance(CreateTripDto, { agreedPrice: '0' }))).toContain(
      'must be greater than zero',
    );
  });

  it('leaves an optional advance of zero alone', () => {
    // Zero advance means "none given", which is a real answer — unlike a
    // zero-so'm expense, which is a mistake.
    expect(messagesFor(plainToInstance(CreateTripDto, { driverAdvance: '0' }))).toEqual([]);
  });
});
