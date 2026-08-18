import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoneyInput } from './MoneyInput';
import { somToTiyin } from '../utils/money';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * A bare number field asked people to count zeroes: `1000000` and `10000000`
 * differ by one character and by ten million so'm, and the mistake is
 * invisible until it is in the ledger (M-14, TASK-5.2).
 */
describe('MoneyInput', () => {
  const setup = (value = '') => {
    const onChange = vi.fn();
    render(<MoneyInput value={value} onChange={onChange} aria-label="amount" />);
    return { input: screen.getByLabelText('amount') as HTMLInputElement, onChange };
  };

  it('groups what is typed so the magnitude is readable', () => {
    const { input } = setup('1000000');
    expect(input.value).toBe('1 000 000');
  });

  it('hands back raw digits, which is what somToTiyin expects', () => {
    const { input, onChange } = setup('');
    fireEvent.change(input, { target: { value: '1 250 000' } });

    expect(onChange).toHaveBeenCalledWith('1250000');
    expect(somToTiyin('1250000')).toBe('125000000');
  });

  it('ignores anything that is not a digit', () => {
    const { input, onChange } = setup('');
    fireEvent.change(input, { target: { value: '12a3-4.5' } });

    expect(onChange).toHaveBeenCalledWith('12345');
  });

  it('is a text field, not a number one', () => {
    // A number field silently accepts `1e9`, and its spinner is a way to
    // change money by scrolling past it.
    const { input } = setup('100');
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('numeric');
  });

  it('says which unit it means', () => {
    setup('100');
    expect(screen.getByText('common.som')).toBeTruthy();
  });

  it('shows nothing at all when empty', () => {
    const { input } = setup('');
    expect(input.value).toBe('');
  });

  it('drops leading zeroes rather than pretending 007 is a number', () => {
    const { input } = setup('007');
    expect(input.value).toBe('7');
  });

  it('groups an amount past Number.MAX_SAFE_INTEGER without losing a digit', () => {
    const { input } = setup('99999999999999999');
    expect(input.value).toBe('99 999 999 999 999 999');
  });
});
