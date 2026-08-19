import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';

// ---------- Button ----------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-navy hover:brightness-95 font-semibold',
  secondary:
    'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 dark:bg-white/10 dark:text-gray-100 dark:border-white/20 dark:hover:bg-white/20',
  danger: 'bg-danger text-white hover:brightness-95',
  ghost: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cn(
        // min-h-11 ≈ 44px: the minimum comfortable touch target on a phone.
        'inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_STYLES[variant],
        className,
      )}
    />
  );
}

// ---------- Form controls ----------

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  // min-h-11 and text-base on mobile: anything under 16px makes iOS Safari zoom
  // the whole page on focus, which then cannot be zoomed back out.
  'w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base sm:text-sm text-gray-900 outline-none focus:border-accent dark:border-white/20 dark:bg-white/10 dark:text-gray-100';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, props.className)} />;
}

/** Search box with a built-in clear affordance (L-5). */
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-64">
      <Input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="pr-8"
      />
      {value ? (
        <button
          type="button"
          aria-label="clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted"
          onClick={() => onChange('')}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(CONTROL, 'dark:[&>option]:text-gray-900', props.className)} />
  );
}

// ---------- Layout ----------

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    // Stacks on a phone: a row of action buttons next to a title is what forced
    // the page wider than the viewport at 375px (H-9).
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <h1 className="text-lg font-bold sm:text-xl">{title}</h1>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------- Table ----------

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
      <table className="w-full min-w-[640px] border-collapse bg-white text-sm dark:bg-white/5">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase text-muted dark:border-white/10">
            {headers.map((header, index) => (
              <th key={index} className="px-3 py-2 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-gray-100 last:border-0 dark:border-white/5',
        onClick && 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/10',
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2', className)}>{children}</td>;
}

// ---------- Badge ----------

export function Badge({
  tone,
  children,
}: {
  tone: 'gray' | 'blue' | 'green' | 'red' | 'orange';
  children: ReactNode;
}) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
    green: 'bg-success/15 text-success',
    red: 'bg-danger/15 text-danger',
    orange: 'bg-accent/20 text-amber-700 dark:text-accent',
  };
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  );
}

// ---------- Modal ----------

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog (L-4).
 *
 * Previously a plain div: screen readers announced nothing, Tab wandered out
 * into the page behind it, focus was never moved in or returned, and the page
 * scrolled under the overlay on a phone. All four are handled here.
 */
export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog so the keyboard lands somewhere useful.
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables?.[0] ?? dialogRef.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Focus trap: cycle within the dialog instead of escaping behind it.
      const items = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!items || items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 pt-8 sm:p-4 sm:pt-16"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl outline-none sm:p-5 dark:bg-navy dark:text-gray-100 dark:ring-1 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-4 text-lg font-bold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

// ---------- States ----------

export function Spinner() {
  const { t } = useTranslation();
  return <div className="py-8 text-center text-sm text-muted">{t('common.loading')}</div>;
}

export function EmptyState() {
  const { t } = useTranslation();
  return <div className="py-8 text-center text-sm text-muted">{t('common.empty')}</div>;
}

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const message = error instanceof Error ? error.message : t('common.errorGeneric');
  return <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{message}</div>;
}

// ---------- Pagination ----------

export function Pagination({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm">
      <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← {t('common.prev')}
      </Button>
      <span className="text-muted">
        {t('common.page')} {page} / {pages}
      </span>
      <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('common.next')} →
      </Button>
    </div>
  );
}
