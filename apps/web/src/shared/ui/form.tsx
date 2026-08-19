import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../utils/cn';
import { IconChevronDown, IconSearch } from './icons';

/**
 * iOS-style controls: soft radius, hairline border, a focus ring that tints
 * rather than shouts, and never a browser default outline.
 */
const CONTROL_BASE =
  'w-full rounded-md border bg-surface px-3.5 text-body text-ink placeholder:text-ink-tertiary ' +
  'transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-ios ' +
  'border-line hover:border-line-strong ' +
  'focus:border-brand-primary focus:outline-none focus:ring-4 focus:ring-brand-primary/15 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'dark:bg-white/[0.05]';

const CONTROL_HEIGHT = 'h-11';

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-subhead font-medium text-ink-secondary">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-footnote text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-footnote text-ink-tertiary">{hint}</span>
      ) : null}
    </label>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  invalid?: boolean;
  /** Leading adornment — an icon or a unit; kept out of the text flow. */
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export function Input({ className, invalid, prefix, suffix, ...props }: InputProps) {
  const control = (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        CONTROL_HEIGHT,
        // Money and quantities line up column-to-column.
        (props.inputMode === 'numeric' || props.type === 'number') && 'tabular-nums',
        invalid && 'border-danger focus:border-danger focus:ring-danger/15',
        Boolean(prefix) && 'pl-10',
        Boolean(suffix) && 'pr-12',
        className,
      )}
    />
  );

  if (!prefix && !suffix) return control;

  return (
    <span className="relative block">
      {prefix ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-tertiary">
          {prefix}
        </span>
      ) : null}
      {control}
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-footnote text-ink-tertiary">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

export function SearchInput(props: InputProps) {
  return <Input type="search" prefix={<IconSearch size={18} />} {...props} />;
}

/** Currency entry — the unit rides in the control so labels stay short. */
export function CurrencyInput({ unit, ...props }: InputProps & { unit: string }) {
  return <Input inputMode="numeric" suffix={unit} {...props} />;
}

export function Select({
  className,
  children,
  invalid,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <span className="relative block">
      <select
        {...props}
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL_BASE,
          CONTROL_HEIGHT,
          invalid && 'border-danger focus:border-danger focus:ring-danger/15',
          'cursor-pointer appearance-none pr-10 dark:[&>option]:bg-surface dark:[&>option]:text-ink',
          className,
        )}
      >
        {children}
      </select>
      <IconChevronDown
        size={16}
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
      />
    </span>
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        'min-h-[88px] py-2.5',
        invalid && 'border-danger focus:border-danger focus:ring-danger/15',
        className,
      )}
    />
  );
}
