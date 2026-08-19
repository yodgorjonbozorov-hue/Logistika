import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-pill font-semibold ' +
  'transition-[background-color,color,box-shadow,transform] duration-[var(--duration-fast)] ease-ios ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-primary text-white shadow-xs hover:bg-brand-deep',
  secondary:
    'bg-surface text-ink border border-line hover:bg-surface-sunken dark:bg-white/[0.06] dark:hover:bg-white/[0.12]',
  danger: 'bg-danger text-white shadow-xs hover:brightness-[0.94]',
  ghost: 'text-ink-secondary hover:bg-ink/[0.06] dark:hover:bg-white/[0.08]',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-subhead',
  md: 'h-11 px-5 text-body',
  lg: 'h-12 px-6 text-headline',
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-12 w-12',
};

function ButtonSpinner() {
  return (
    <span
      className="h-4 w-4 animate-lx-spin rounded-full border-2 border-current border-t-transparent opacity-70"
      aria-hidden="true"
    />
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the label for a spinner and blocks input — never shifts layout. */
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], block && 'w-full', className)}
    >
      {loading ? <ButtonSpinner /> : icon}
      {children}
    </button>
  );
}

/** Square action with an accessible name — toolbar and header affordances. */
export function IconButton({
  variant = 'ghost',
  size = 'md',
  className,
  children,
  type = 'button',
  ...props
}: Omit<ButtonProps, 'icon' | 'block' | 'loading'> & { 'aria-label': string }) {
  return (
    <button
      {...props}
      type={type}
      className={cn(BASE, VARIANTS[variant], ICON_SIZES[size], 'p-0', className)}
    >
      {children}
    </button>
  );
}
