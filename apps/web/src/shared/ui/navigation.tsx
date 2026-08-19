import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';
import { Button } from './Button';
import { IconChevronLeft, IconChevronRight } from './icons';

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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-title2 font-semibold">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-subhead text-ink-secondary">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** iOS segmented control — two or three mutually exclusive views. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex rounded-pill border border-line bg-surface-sunken p-1 dark:bg-white/[0.06]',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-pill px-4 py-1.5 text-subhead font-medium transition-all duration-[var(--duration-fast)] ease-ios',
              active
                ? 'bg-surface text-ink shadow-xs dark:bg-white/[0.14]'
                : 'text-ink-secondary hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Underlined tabs for in-page sections (trip card, finance). */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'whitespace-nowrap border-b-2 px-4 py-2.5 text-subhead font-medium transition-colors duration-[var(--duration-fast)] ease-ios',
              active
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-ink-secondary hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

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
    <nav className="mt-4 flex items-center justify-end gap-2 text-subhead">
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        icon={<IconChevronLeft size={16} />}
      >
        {t('common.prev')}
      </Button>
      <span className="px-1 font-mono text-footnote tabular-nums text-ink-tertiary">
        {page} / {pages}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {t('common.next')}
        <IconChevronRight size={16} />
      </Button>
    </nav>
  );
}
