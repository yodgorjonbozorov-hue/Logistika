/**
 * Nocturne UI kit — the component layer of the design system, as React.
 *
 * Every visual value comes from the tokens in `shared/theme/nocturne.css`;
 * components never hard-code a hex or a font. User-facing strings live in i18n,
 * so nothing here ships literal copy.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';

// ---------- Icon ----------

/** A Phosphor glyph. `name` is the icon slug without the `ph-` prefix. */
export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <i
      aria-hidden="true"
      className={cn('ph', `ph-${name}`, className)}
      style={{ fontSize: size, ...style }}
    />
  );
}

// ---------- Button ----------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  icon,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: string;
}) {
  return (
    <button {...props} className={cn('btn', `btn-${variant}`, className)}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string }) {
  return (
    <button {...props} className={cn('btn btn-secondary btn-icon', className)}>
      <Icon name={icon} size={16} />
    </button>
  );
}

// ---------- Form controls ----------

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn('field block', className)}>
      <span className="mb-[5px] block text-xs text-neutral-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11.5px] text-neutral-600">{hint}</span> : null}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('input', props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('input', props.className)} />;
}

// ---------- Segmented control ----------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('seg', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="seg-opt"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Layout ----------

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end gap-4', className)}>
      <div>
        <h3 className="m-0 mb-[3px] text-[22px]">{title}</h3>
        {subtitle ? <div className="text-[13px] text-neutral-500">{subtitle}</div> : null}
      </div>
      <div className="flex-1" />
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className,
  style,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div className={cn('card', className)} style={style} onClick={onClick}>
      {children}
    </div>
  );
}

/** The small uppercase kicker that labels a card's metric. */
export function CardLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.04em] text-neutral-500">
      {children}
    </div>
  );
}

/** A dashboard metric: big number, optional unit and delta line. */
export function StatCard({
  label,
  value,
  unit,
  delta,
  deltaTone = 'neutral',
  children,
}: {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  delta?: ReactNode;
  deltaTone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'accent';
  children?: ReactNode;
}) {
  const deltaColor = {
    neutral: 'var(--color-neutral-500)',
    positive: 'var(--color-positive-text)',
    warning: 'var(--color-warning-text)',
    danger: 'var(--color-danger-text)',
    accent: 'var(--color-accent-300)',
  }[deltaTone];

  return (
    <Card className="px-4 py-[14px]">
      <CardLabel>{label}</CardLabel>
      <div className="flex items-baseline gap-2">
        <span className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums">{value}</span>
        {unit ? <span className="text-xs text-neutral-500">{unit}</span> : null}
      </div>
      {delta ? (
        <div className="mt-1 text-xs" style={{ color: deltaColor }}>
          {delta}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

/** A labelled proportion bar — used by the reports and dashboard breakdowns. */
export function MeterRow({
  label,
  value,
  percent,
  color = 'var(--color-accent)',
}: {
  label: ReactNode;
  value: ReactNode;
  percent: number;
  color?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[12.5px]">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="h-1.5 rounded-[3px] bg-neutral-900">
        <div
          className="h-full rounded-[3px]"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ---------- Table ----------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('table', className)}>{children}</table>
    </div>
  );
}

export function Row({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr onClick={onClick} className={cn(onClick && 'cursor-pointer', className)}>
      {children}
    </tr>
  );
}

export function Cell({
  children,
  className,
  style,
  align,
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        align === 'right' && 'text-right tabular-nums',
        align === 'center' && 'text-center',
        className,
      )}
      style={style}
    >
      {children}
    </td>
  );
}

// ---------- Chips and tags ----------

export type ChipTone =
  'accent' | 'accentSoft' | 'neutral' | 'muted' | 'positive' | 'warning' | 'danger' | 'info';

/** [text color, dot/border color] per tone — mirrors the design's `stMeta`. */
const CHIP_TONES: Record<ChipTone, [string, string]> = {
  accent: ['var(--color-accent-200)', 'var(--color-accent)'],
  accentSoft: ['var(--color-accent-300)', 'var(--color-accent-500)'],
  neutral: ['var(--color-neutral-400)', 'var(--color-neutral-600)'],
  muted: ['var(--color-neutral-500)', 'var(--color-neutral-700)'],
  positive: ['var(--color-positive-text)', 'var(--color-positive)'],
  warning: ['var(--color-warning-text)', 'var(--color-warning)'],
  danger: ['var(--color-danger-text)', 'var(--color-danger)'],
  info: ['var(--color-info-text)', 'var(--color-info)'],
};

/** A pill with a leading status dot, tinted from its tone. */
export function StatusChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  const [text, dot] = CHIP_TONES[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11.5px] font-medium"
      style={{
        color: text,
        border: `1px solid color-mix(in srgb, ${dot} 45%, transparent)`,
        background: `color-mix(in srgb, ${dot} 10%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {children}
    </span>
  );
}

export function Tag({
  variant = 'neutral',
  children,
  className,
}: {
  variant?: 'accent' | 'neutral' | 'outline';
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn('tag', `tag-${variant}`, className)}>{children}</span>;
}

/** Round initials badge. `tone` accent marks the signed-in user and owners. */
export function Avatar({
  initials,
  size = 27,
  tone = 'neutral',
}: {
  initials: string;
  size?: number;
  tone?: 'neutral' | 'accent';
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.39),
        background: tone === 'accent' ? 'var(--color-accent-800)' : 'var(--color-neutral-800)',
        color: tone === 'accent' ? 'var(--color-accent-200)' : 'var(--color-neutral-300)',
      }}
    >
      {initials}
    </span>
  );
}

/** First letters of the first two words, e.g. "Alisher Qodirov" → "AQ". */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return '—';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ---------- Modal ----------

export function Modal({
  title,
  icon,
  open,
  onClose,
  children,
  actions,
  width = 420,
}: {
  title: string;
  icon?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        className="dialog"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-title flex items-center gap-2.5">
          {icon ? <Icon name={icon} size={20} style={{ color: 'var(--color-danger)' }} /> : null}
          {title}
        </div>
        <div className="dialog-body">{children}</div>
        {actions ? <div className="dialog-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

// ---------- States ----------

export function Spinner() {
  const { t } = useTranslation();
  return <div className="py-8 text-center text-[13px] text-neutral-500">{t('common.loading')}</div>;
}

export function EmptyState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="py-10 text-center text-[13px] text-neutral-500">
      {message ?? t('common.empty')}
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const message = error instanceof Error ? error.message : t('common.errorGeneric');
  return (
    <div
      className="mb-3 flex items-start gap-2 rounded-md px-3 py-2.5 text-[12.5px]"
      style={{
        color: 'var(--color-danger-text)',
        border: '1px solid color-mix(in srgb, var(--color-danger) 45%, transparent)',
        background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
      }}
    >
      <Icon name="warning-circle" size={15} className="mt-px shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ---------- Pagination ----------

export function Pagination({
  page,
  limit,
  total,
  onPage,
  label,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);
  const numbers = pageNumbers(page, pages);

  return (
    <div className="flex items-center border-t border-divider px-[18px] py-[11px] text-[12.5px] text-neutral-500">
      <span>{label ?? `${first}–${last} / ${total}`}</span>
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-neutral-800 disabled:opacity-40"
        >
          <Icon name="caret-left" size={12} />
        </button>
        {numbers.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            aria-current={n === page ? 'page' : undefined}
            className={cn(
              'flex h-[26px] w-[26px] items-center justify-center rounded-[6px]',
              n === page ? 'font-semibold text-accent-200' : 'text-neutral-400',
            )}
            style={
              n === page
                ? { background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }
                : undefined
            }
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-neutral-800 disabled:opacity-40"
        >
          <Icon name="caret-right" size={12} />
        </button>
      </div>
    </div>
  );
}

/** Up to five page numbers, centred on the current page. */
export function pageNumbers(page: number, pages: number, window = 3): number[] {
  const total = Math.max(1, pages);
  const size = Math.min(window, total);
  let start = Math.max(1, page - Math.floor(size / 2));
  if (start + size - 1 > total) start = total - size + 1;
  return Array.from({ length: size }, (_, i) => start + i);
}
