import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';

/**
 * So'm, grouped while you type (TASK-5.2, M-14).
 *
 * A bare number field asked people to count zeroes: `1000000` and `10000000`
 * differ by one character and by ten million so'm, and the error is invisible
 * until it is in the ledger. Grouping makes the magnitude readable at a glance,
 * and the suffix says which unit is meant — the wire format is tiyin, so
 * "so'm" on screen is a real statement, not decoration.
 *
 * The value handed back is always the raw digits, so `somToTiyin` sees what it
 * has always seen.
 */
const group = (digits: string): string =>
  digits === ''
    ? ''
    : BigInt(digits)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function MoneyInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  /** Raw digits, no separators. */
  value: string;
  onChange: (digits: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="relative">
      <input
        {...props}
        // `text`, not `number`: a number field silently accepts `1e9` and
        // exponent notation, and its spinner is a way to change money by
        // scrolling past the field.
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={group(value)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        className={cn(
          'w-full rounded-lg border border-gray-300 bg-white py-1.5 pl-3 pr-14 text-right text-sm tabular-nums text-gray-900 outline-none focus:border-accent dark:border-white/20 dark:bg-white/10 dark:text-gray-100',
          className,
        )}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
        {t('common.som')}
      </span>
    </div>
  );
}
