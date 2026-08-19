import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

/** Premium radius, hairline border, a shadow you feel rather than see. */
export function Card({
  children,
  className,
  padded = true,
  tone = 'surface',
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  /** `navy` is the brand board's inverted card — used for AI panels. */
  tone?: 'surface' | 'navy';
}) {
  return (
    <div
      className={cn(
        'rounded-lg shadow-sm',
        tone === 'navy'
          ? 'bg-brand-secondary text-white ring-1 ring-white/10'
          : 'border border-line bg-surface',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  action,
  kicker,
}: {
  title: string;
  action?: ReactNode;
  kicker?: string;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        {kicker ? (
          <div className="mb-1 font-mono text-[10px] uppercase tracking-kicker text-brand-primary">
            {kicker}
          </div>
        ) : null}
        <h2 className="text-headline font-semibold">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/** A KPI tile: quiet label, monospaced figure, signed delta. */
export function StatCard({
  label,
  value,
  delta,
  trend = 'neutral',
  tone = 'surface',
  icon,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  tone?: 'surface' | 'navy';
  icon?: ReactNode;
}) {
  const trendClass =
    trend === 'up' ? 'text-success' : trend === 'down' ? 'text-danger' : 'text-ink-tertiary';

  return (
    <Card tone={tone} className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'truncate text-footnote',
            tone === 'navy' ? 'text-white/60' : 'text-ink-secondary',
          )}
        >
          {label}
        </span>
        {icon ? <span className="text-ink-tertiary">{icon}</span> : null}
      </div>
      <div className="mt-2 font-mono text-title2 font-semibold tabular-nums">{value}</div>
      {delta ? (
        <div className={cn('mt-1 font-mono text-footnote tabular-nums', trendClass)}>{delta}</div>
      ) : null}
    </Card>
  );
}

/** Label above value — used on detail screens and the public tracking page. */
export function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-footnote text-ink-tertiary">{label}</div>
      <div className="mt-0.5 truncate text-subhead">{children}</div>
    </div>
  );
}
