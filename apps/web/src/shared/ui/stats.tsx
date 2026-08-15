import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Period } from '../api/analytics';
import { cn } from '../utils/cn';
import { dayBounds, formatBp, toDateInput } from '../utils/format';
import { formatTiyin } from '../utils/money';
import { Card, Input } from './index';

/** One W-1 card: a label, a big number and an optional hint underneath. */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'success' | 'danger' | 'accent';
}) {
  const tones = {
    default: '',
    success: 'text-success',
    danger: 'text-danger',
    accent: 'text-accent',
  };
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={cn('mt-1 text-xl font-bold tabular-nums', tones[tone])}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </Card>
  );
}

/** From/to range shared by the finance, fuel and report screens. */
export function PeriodPicker({
  period,
  onChange,
}: {
  period: Period;
  onChange: (period: Period) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-end gap-2">
      <label className="text-xs text-muted">
        <span className="mb-1 block">{t('period.from')}</span>
        <Input
          type="date"
          className="w-40"
          value={toDateInput(period.from)}
          onChange={(e) => onChange({ ...period, from: dayBounds(e.target.value) })}
        />
      </label>
      <label className="text-xs text-muted">
        <span className="mb-1 block">{t('period.to')}</span>
        <Input
          type="date"
          className="w-40"
          value={toDateInput(period.to)}
          onChange={(e) => onChange({ ...period, to: dayBounds(e.target.value, true) })}
        />
      </label>
    </div>
  );
}

export interface TrendPoint {
  month: string;
  revenue: string;
  cost: string;
  profit: string;
}

/**
 * 12-month profit chart (TZ W-1). Plain SVG on purpose — one chart does not
 * justify a charting dependency, and the bars stay readable in both themes.
 */
export function ProfitChart({ data }: { data: TrendPoint[] }) {
  const { t } = useTranslation();
  const values = data.map((point) => ({
    ...point,
    profitNumber: Number(BigInt(point.profit) / 100n),
  }));
  const peak = Math.max(1, ...values.map((point) => Math.abs(point.profitNumber)));

  return (
    <Card>
      <div className="mb-3 text-sm font-semibold">{t('dashboard.profitChart')}</div>
      <div className="flex h-40 items-end gap-1">
        {values.map((point) => {
          const height = Math.round((Math.abs(point.profitNumber) / peak) * 100);
          const negative = point.profitNumber < 0;
          return (
            <div key={point.month} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div
                title={`${point.month}: ${formatTiyin(point.profit)}`}
                style={{ height: `${Math.max(height, 2)}%` }}
                className={cn('w-full rounded-t', negative ? 'bg-danger/70' : 'bg-accent')}
              />
              <span className="text-[10px] text-muted">{point.month.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Share-of-total bars — the «pie chart» of the expense structure (W-9). */
export function ShareBars({
  rows,
}: {
  rows: Array<{ label: string; amount: string; shareBp: number | null }>;
}) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="flex justify-between text-sm">
            <span>{row.label}</span>
            <span className="tabular-nums text-muted">
              {formatTiyin(row.amount)} · {formatBp(row.shareBp)}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-gray-200 dark:bg-white/10">
            <div
              className="h-2 rounded-full bg-accent"
              style={{ width: `${Math.min(100, (row.shareBp ?? 0) / 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
