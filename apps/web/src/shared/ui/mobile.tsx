/**
 * The mobile half of the Nocturne kit.
 *
 * Same tokens, same visual language as the desktop components next door — the
 * difference is shape, not style: a sheet instead of a centred dialog, a card
 * instead of a table row, a thumb-sized target instead of a 26px one.
 */
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';
import { Button, Icon } from './index';

// ---------- Bottom sheet ----------

/**
 * A panel anchored to the bottom edge. Used for filters, menus and any choice
 * that would be a popover on desktop — on a phone the bottom edge is the only
 * part of the screen a thumb reaches comfortably.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  actions,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    // The page behind a sheet must not scroll, or a flick meant for the sheet
    // moves the page and the sheet appears frozen.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className={cn('sheet', className)}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        {title ? (
          <div className="sheet-head">
            <span className="min-w-0 flex-1 truncate">{title}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-400"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        ) : null}
        <div className="sheet-body">{children}</div>
        {actions ? <div className="sheet-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

// ---------- Filters ----------

/** Opens the filter sheet and shows how many filters are currently narrowing the list. */
export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-secondary relative shrink-0 gap-1.5"
      aria-label={t('common.filters')}
    >
      <Icon name="funnel" size={16} />
      <span>{t('common.filters')}</span>
      {count > 0 ? (
        <span className="ml-0.5 rounded-full bg-accent-800 px-[7px] text-[11px] font-semibold leading-[18px] text-accent-200">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** The sheet itself: the page supplies the fields, this supplies apply/clear. */
export function FilterSheet({
  open,
  onClose,
  onClear,
  count,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onClear: () => void;
  count: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('common.filters')}
      actions={
        <>
          <Button variant="secondary" onClick={onClear} disabled={count === 0}>
            {t('common.clear')}
          </Button>
          <Button onClick={onClose}>{t('common.apply')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5 pt-1">{children}</div>
    </Sheet>
  );
}

/** Full-width search box — on a phone a list's search is never a 230px sliver. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'flex min-h-[44px] items-center gap-2 rounded-md border border-neutral-800 px-[11px] text-[13px] text-neutral-500 focus-within:border-neutral-700',
        className,
      )}
    >
      <Icon name="magnifying-glass" size={16} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        type="search"
        className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-neutral-500 md:text-[13px]"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="shrink-0 text-neutral-500"
          aria-label="clear"
        >
          <Icon name="x-circle" size={16} />
        </button>
      ) : null}
    </label>
  );
}

// ---------- List card (the mobile stand-in for a table row) ----------

/**
 * One record as a card. `title` and `trailing` form the first line — the two
 * things a dispatcher scans for — and `meta` carries the rest as label/value
 * pairs. Anything beyond that belongs on the record's own page.
 */
export function ListCard({
  title,
  subtitle,
  leading,
  trailing,
  meta,
  footer,
  onClick,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'card w-full px-3.5 py-3 text-left',
        onClick && 'active:bg-neutral-900/60',
        // A card is a tap target; give it the same floor as a button.
        'min-h-[64px]',
      )}
    >
      <div className="flex items-start gap-2.5">
        {leading ? <div className="mt-px shrink-0">{leading}</div> : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium leading-tight">{title}</div>
          {subtitle ? (
            <div className="mt-[3px] truncate text-[12px] text-neutral-500">{subtitle}</div>
          ) : null}
        </div>
        {trailing ? <div className="shrink-0 pl-1">{trailing}</div> : null}
        {onClick ? (
          <Icon
            name="caret-right"
            size={14}
            className="mt-1 shrink-0"
            style={{ color: 'var(--color-neutral-600)' }}
          />
        ) : null}
      </div>
      {meta ? (
        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">{meta}</div>
      ) : null}
      {footer ? <div className="mt-2.5 text-[12px] text-neutral-500">{footer}</div> : null}
    </Tag>
  );
}

/** A label/value pair inside a {@link ListCard} or a detail block. */
export function MetaItem({
  label,
  children,
  full,
}: {
  label: ReactNode;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn('min-w-0', full && 'col-span-2')}>
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-neutral-600">{label}</div>
      <div className="truncate text-[12.5px] text-neutral-300">{children}</div>
    </div>
  );
}

/** A stacked list of cards with consistent spacing. */
export function CardList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2', className)}>{children}</div>;
}

// ---------- Loading, empty and error states ----------

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={cn('skel', className)} style={style} aria-hidden="true" />;
}

/** Placeholder cards, sized like the list they stand in for. */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="card px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="mt-2 h-2.5 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder tiles for a KPI row or a chart block. */
export function SkeletonCards({ count = 6, height = 92 }: { count?: number; height?: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
      role="status"
      aria-label={t('common.loading')}
    >
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="rounded-md" style={{ height }} />
      ))}
    </div>
  );
}

/** The whole-page fallback used while a lazily loaded route arrives. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-3 w-64" />
      </div>
      <SkeletonCards count={3} height={80} />
      <SkeletonList rows={4} />
    </div>
  );
}

/**
 * Nothing to show — and why. `action` is what the reader should do about it,
 * which is the part a bare "no data" line always leaves out.
 */
export function EmptyBlock({
  icon = 'tray',
  title,
  description,
  action,
}: {
  icon?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: 'color-mix(in srgb, var(--color-neutral-800) 60%, transparent)' }}
      >
        <Icon name={icon} size={22} style={{ color: 'var(--color-neutral-500)' }} />
      </span>
      <div className="text-[14px] font-medium">{title ?? t('common.empty')}</div>
      {description ? (
        <div className="mt-1 max-w-[280px] text-[12.5px] text-neutral-500">{description}</div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A failed load, with the one control that can fix it. */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : t('common.errorGeneric');
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: 'color-mix(in srgb, var(--color-danger) 12%, transparent)' }}
      >
        <Icon name="warning-circle" size={22} style={{ color: 'var(--color-danger)' }} />
      </span>
      <div className="text-[14px] font-medium">{t('common.errorTitle')}</div>
      <div className="mt-1 max-w-[300px] text-[12.5px] text-neutral-500">{message}</div>
      {onRetry ? (
        <Button variant="secondary" icon="arrow-clockwise" className="mt-4" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The one place a list decides what to render: skeleton, error, empty or the
 * rows themselves. Every list page routes through it, so no page can forget a
 * state.
 */
export function ListState({
  isLoading,
  error,
  isEmpty,
  onRetry,
  empty,
  skeleton,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  onRetry?: () => void;
  empty?: ReactNode;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  if (isLoading) return <>{skeleton ?? <SkeletonList />}</>;
  if (error) return <ErrorBlock error={error} onRetry={onRetry} />;
  if (isEmpty) return <>{empty ?? <EmptyBlock />}</>;
  return <>{children}</>;
}
