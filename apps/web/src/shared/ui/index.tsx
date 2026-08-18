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
        // A focus ring that survives dark mode: `outline` follows the element's
        // own colour, so a keyboard user could otherwise lose the cursor
        // entirely on the navy background.
        'rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
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
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  /** Message for this field, usually from the server's `details` (TASK-5.3). */
  error?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {children}
      {/* The error replaces the hint rather than stacking under it: once
          something is wrong, telling the user how it normally works is noise. */}
      {error ? (
        <span
          role="alert"
          className="mt-1 block text-xs font-medium text-danger-text dark:text-danger"
        >
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-text dark:text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent dark:border-white/20 dark:bg-white/10 dark:text-gray-100';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(CONTROL, 'dark:[&>option]:text-gray-900', props.className)} />
  );
}

// ---------- Layout ----------

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="flex items-center gap-2">{actions}</div>
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
          <tr className="border-b border-gray-200 text-left text-xs uppercase text-muted-text dark:text-muted dark:border-white/10">
            {headers.map((header, index) => (
              // `scope` is what tells a screen reader this cell heads a
              // column; without it the table is read as a grid of loose values.
              <th key={index} scope="col" className="px-3 py-2 font-semibold">
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
    green: 'bg-success/15 text-success-text dark:text-success',
    red: 'bg-danger/15 text-danger-text dark:text-danger',
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
 * A dialog a keyboard can actually use (L-10, TASK-5.5).
 *
 * It was a `div` over the page: Tab walked straight out of it into the form
 * behind, a screen reader announced nothing, and closing it left focus
 * wherever the DOM happened to put it — usually the top of the document, so a
 * keyboard user started the page again from scratch.
 *
 * `aria-modal` and `role="dialog"` say what it is, the trap keeps Tab inside,
 * and focus returns to whatever opened it.
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
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    // Remembered before focus moves, so it can be handed back on close.
    const opener = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      if (document.activeElement === edge) {
        // Wrap rather than escape: leaving the dialog with Tab is how a
        // keyboard user ends up typing into the form they cannot see.
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl outline-none dark:bg-navy dark:text-gray-100 dark:ring-1 dark:ring-white/10"
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
  return (
    <div className="py-8 text-center text-sm text-muted-text dark:text-muted">
      {t('common.loading')}
    </div>
  );
}

/**
 * A table's shape while it loads (TASK-5.3).
 *
 * A spinner in place of a list makes the page jump when the rows arrive and
 * says nothing about how much is coming. Grey rows of the right height keep
 * the layout still, which is the entire point.
 *
 * `aria-hidden` because it carries no information a screen reader wants; the
 * live region that announces "loading" belongs to the page, not to the bars.
 */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('common.loading')} className="space-y-2 py-2">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3" aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => (
            <div
              key={column}
              className="h-8 flex-1 animate-pulse rounded bg-gray-200 dark:bg-white/10"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The map's shape while the first positions load. */
export function MapSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('common.loading')}
      className="h-[70vh] w-full animate-pulse rounded-xl bg-gray-200 dark:bg-white/10"
    />
  );
}

export function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="py-8 text-center text-sm text-muted-text dark:text-muted">
      {t('common.empty')}
    </div>
  );
}

/**
 * The failure a person needs to read.
 *
 * A validation reply carries a `details` list naming each bad field. Those are
 * shown under the fields themselves when the form passes `fieldErrors` down;
 * whatever is left over — a rule about the record as a whole, or a message the
 * parser could not attribute — is listed here, because silently dropping it
 * leaves the user with "something is wrong" and no way to find out what.
 */
export function ErrorMessage({ error, only }: { error: unknown; only?: string[] }) {
  const { t } = useTranslation();
  if (!error) return null;
  const message = error instanceof Error ? error.message : t('common.errorGeneric');
  const extra = only ?? [];
  return (
    <div
      role="alert"
      className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger-text dark:text-danger"
    >
      {message}
      {extra.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs">
          {extra.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
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
      <span className="text-muted-text dark:text-muted">
        {t('common.page')} {page} / {pages}
      </span>
      <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('common.next')} →
      </Button>
    </div>
  );
}
