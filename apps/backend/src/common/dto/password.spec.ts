import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { IsStrongPassword, PASSWORD_MIN_LENGTH } from './password';

class Account {
  fullName = 'Alisher Karimov';
  email = 'alisher@demo.uz';

  @IsStrongPassword()
  password = '';
}

function check(password: string, overrides: Partial<Account> = {}): boolean {
  const account = Object.assign(new Account(), overrides, { password });
  return validateSync(account).length === 0;
}

describe('IsStrongPassword', () => {
  it('accepts a reasonable password', () => {
    expect(check('Yulduz7Kema')).toBe(true);
  });

  it(`rejects anything shorter than ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(check('Abc12345')).toBe(false);
    expect(check('Abcd12345')).toBe(false);
    expect(check('Abcde12345')).toBe(true);
  });

  it('requires both a letter and a digit', () => {
    expect(check('1234567890')).toBe(false);
    expect(check('abcdefghij')).toBe(false);
    expect(check('abcdefghi1')).toBe(true);
  });

  it('rejects well-known passwords, including with trailing digits', () => {
    // "password1" is the shape people actually pick when told to add a number.
    expect(check('password12')).toBe(false);
    expect(check('parol12345')).toBe(false);
    expect(check('qwerty1234')).toBe(false);
    expect(check('truckcontrol1')).toBe(false);
  });

  it('rejects a password built from the account holder own name or email', () => {
    expect(check('alisher2026')).toBe(false);
    expect(check('Karimov2026')).toBe(false);
    // A different person's details are irrelevant.
    expect(check('alisher2026', { fullName: 'Dilnoza Rahimova', email: 'd@demo.uz' })).toBe(true);
  });

  it('ignores short name fragments so ordinary passwords are not blocked', () => {
    // Two- and three-letter fragments would reject almost everything.
    expect(check('Bulutli9Tog', { fullName: 'Ali Vali', email: 'av@demo.uz' })).toBe(true);
  });

  it('rejects a non-string value outright', () => {
    const account = Object.assign(new Account(), { password: 12_345_678_901 as never });
    expect(validateSync(account).length).toBeGreaterThan(0);
  });
});
