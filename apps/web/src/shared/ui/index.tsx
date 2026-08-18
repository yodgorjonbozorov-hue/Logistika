import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';

// ---------- Button ----------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-navy hover:brightness-95 font-semibold shadow-sm',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-95 font-medium',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  subtle: 'bg-surface-2 text-ink hover:brightness-95',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2.5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg transition disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_STYLES[variant],
        BUTTON_SIZES[size],
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
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-2">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-2/70 focus:border-accent disabled:opacity-60';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CONTROL, 'min-h-[80px]', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(CONTROL, 'pr-8', props.className)} />;
}

// ---------- Layout ----------

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <Tag className={cn('rounded-xl border border-line bg-surface p-4 shadow-card', className)}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">{children}</h2>
      {action}
    </div>
  );
}

/** Filter/action strip above a list — wraps instead of overflowing on phones. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end gap-2">{children}</div>;
}

// ---------- KPI ----------

export function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'success' | 'danger' | 'accent';
  onClick?: () => void;
}) {
  const tones = {
    default: 'text-ink',
    success: 'text-success',
    danger: 'text-danger',
    accent: 'text-accent',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cn(
        'rounded-xl border border-line bg-surface p-4 text-left shadow-card transition',
        onClick && 'hover:border-accent/60 hover:shadow-pop',
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-ink-2">{label}</div>
      <div className={cn('mt-1.5 truncate text-xl font-bold sm:text-2xl money', tones[tone])}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 truncate text-xs text-ink-2">{hint}</div> : null}
    </Tag>
  );
}

// ---------- Table ----------

export function Table({ headers, children }: { headers: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] border-collapse bg-surface text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
            {headers.map((header, index) => (
              <th key={index} className="whitespace-nowrap px-3 py-2.5 font-semibold">
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
        'border-b border-line/70 last:border-0',
        onClick && 'cursor-pointer hover:bg-surface-2',
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>;
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Card title on phones — exactly one column should set it. */
  primary?: boolean;
  /** Secondary line under the title on phones. */
  secondary?: boolean;
  /** Kept out of the phone card entirely (noise on a small screen). */
  desktopOnly?: boolean;
}

/**
 * One column definition, two layouts: a dense table from `md` up, stacked cards
 * below it. Tables never force the page to scroll sideways (TZ §20).
 */
export function DataTable<T>({
  rows,
  columns,
  getKey,
  onRowClick,
  empty,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  getKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (rows.length === 0) return <>{empty ?? <EmptyState />}</>;

  const primary = columns.find((column) => column.primary) ?? columns[0]!;
  const secondary = columns.find((column) => column.secondary);
  const details = columns.filter(
    (column) => column !== primary && column !== secondary && !column.desktopOnly,
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
        <table className="w-full border-collapse bg-surface text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
              {columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line/70 last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-surface-2',
                )}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-3 py-2.5 align-middle', column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={getKey(row)}>
            <div
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick ? (event) => event.key === 'Enter' && onRowClick(row) : undefined
              }
              className={cn(
                'rounded-xl border border-line bg-surface p-3 shadow-card',
                onRowClick && 'cursor-pointer active:bg-surface-2',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 font-semibold">{primary.cell(row)}</div>
                {secondary ? <div className="shrink-0">{secondary.cell(row)}</div> : null}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {details.map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-ink-2">{column.header}</dt>
                    <dd className="truncate text-ink">{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------- Badge ----------

export type BadgeTone = 'gray' | 'blue' | 'green' | 'red' | 'orange';

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    gray: 'bg-surface-2 text-ink-2 ring-line',
    blue: 'bg-blue-500/15 text-blue-600 ring-blue-500/30 dark:text-blue-300',
    green: 'bg-success/15 text-success ring-success/30',
    red: 'bg-danger/15 text-danger ring-danger/30',
    orange: 'bg-accent/20 text-amber-700 ring-accent/40 dark:text-accent',
  };
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ---------- Modal ----------

export function Modal({
  title,
  open,
  onClose,
  children,
  wide,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 p-0 animate-fade-in sm:items-start sm:p-4 sm:pt-16"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full rounded-t-2xl border border-line bg-surface p-5 text-ink shadow-pop animate-slide-up sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---------- States ----------

export function Spinner() {
  const { t } = useTranslation();
  return <div className="py-8 text-center text-sm text-ink-2">{t('common.loading')}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-2', className)} />;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface/50 px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title ?? t('common.empty')}</p>
      {hint ? <p className="mt-1 text-xs text-ink-2">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Marks a surface whose data lands with a later backend stage — never fake numbers. */
export function ComingSoon({ note }: { note?: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-dashed border-accent/40 bg-accent/5 px-4 py-6 text-center">
      <p className="text-sm font-medium text-accent">{t('common.comingSoon')}</p>
      <p className="mt-1 text-xs text-ink-2">{note ?? t('common.comingSoonNote')}</p>
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const message = error instanceof Error ? error.message : t('common.errorGeneric');
  return (
    <div
      role="alert"
      className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {message}
    </div>
  );
}

// ---------- Tabs ----------

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: T; label: string }>;
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line no-scrollbar">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'whitespace-nowrap px-4 py-2 text-sm transition',
            active === tab.key
              ? 'border-b-2 border-accent font-semibold text-accent'
              : 'border-b-2 border-transparent text-ink-2 hover:text-ink',
          )}
        >
          {tab.label}
        </button>
      ))}
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
      <span className="text-ink-2">
        {t('common.page')} {page} / {pages}
      </span>
      <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('common.next')} →
      </Button>
    </div>
  );
}
