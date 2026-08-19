import { useTranslation } from 'react-i18next';
import type { MonthlyFinanceRow } from 'shared';
import { formatTiyin } from '../../shared/utils/money';
import { barPercent, formatBp, formatMonth, maxAbs, TONE_CLASSES, toneForValue } from './format';

/**
 * Revenue / expense / profit by month, drawn with plain CSS bars.
 *
 * No charting library: the whole comparison is three numbers per month, and
 * pulling in a canvas renderer for that would add more to the bundle than every
 * page in the app put together — on a connection where a logist is already
 * waiting. The bar lengths come from BigInt ratios (see `barPercent`), so a
 * month whose revenue exceeds Number.MAX_SAFE_INTEGER is still drawn correctly.
 */
export function MonthlyChart({ rows }: { rows: MonthlyFinanceRow[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;

  // One scale for revenue and expenses so the two bars are comparable; profit
  // gets its own row of text rather than a bar it would dwarf or vanish beside.
  const scale = maxAbs(rows.flatMap((row) => [row.revenue, row.expenses]));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        <Legend className="bg-accent" label={t('dashboard.revenue')} />
        <Legend className="bg-danger" label={t('dashboard.expenses')} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.month} className="align-middle">
                <th
                  scope="row"
                  className="w-20 py-1 pr-2 text-left text-xs font-medium text-muted tabular-nums"
                >
                  {formatMonth(row.month)}
                </th>
                <td className="py-1">
                  <div className="space-y-1">
                    <Bar
                      className="bg-accent"
                      percent={barPercent(row.revenue, scale)}
                      title={`${t('dashboard.revenue')}: ${formatTiyin(row.revenue)}`}
                    />
                    <Bar
                      className="bg-danger"
                      percent={barPercent(row.expenses, scale)}
                      title={`${t('dashboard.expenses')}: ${formatTiyin(row.expenses)}`}
                    />
                  </div>
                </td>
                <td className="w-32 py-1 pl-2 text-right text-xs tabular-nums">
                  <span className={TONE_CLASSES[toneForValue(row.profit)]}>
                    {formatTiyin(row.profit)}
                  </span>
                </td>
                <td className="w-20 py-1 pl-2 text-right text-xs tabular-nums">
                  <span className={TONE_CLASSES[toneForValue(row.revenueChangeBp)]}>
                    {formatBp(row.revenueChangeBp, { signed: true, decimals: 0 })}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Bar({ percent, className, title }: { percent: number; className: string; title: string }) {
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded bg-gray-100 dark:bg-white/10"
      title={title}
      role="img"
      aria-label={title}
    >
      {/* A zero-value month still gets a visible sliver so the row does not read
          as missing data. */}
      <div
        className={`h-full rounded ${className}`}
        style={{ width: `${Math.max(percent, 0)}%` }}
      />
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-4 rounded ${className}`} aria-hidden="true" />
      {label}
    </span>
  );
}
