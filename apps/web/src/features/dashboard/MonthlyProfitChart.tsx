import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MonthlyProfitPoint } from 'shared';
import { Cell, Row, SegmentedControl, Table } from '../../shared/ui';
import { formatTiyin } from '../../shared/utils/money';
import { formatMonth } from '../../shared/utils/units';
import { cn } from '../../shared/utils/cn';

/**
 * Twelve months of profit — one series, coloured by polarity: brand blue for a
 * month in profit, danger red for a month in loss (validated as a diverging
 * pair against both surfaces). Income and expenses ride along in the tooltip
 * rather than as extra series, so the shape of the year stays readable, and a
 * table view carries the same numbers for anyone the chart does not serve.
 */
const CHART_HEIGHT = 132;

export function MonthlyProfitChart({ points }: { points: MonthlyProfitPoint[] }) {
  const { t } = useTranslation();
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const values = points.map((point) => BigInt(point.profit));
  const maxPositive = values.reduce((max, value) => (value > max ? value : max), 0n);
  const maxNegative = values.reduce((min, value) => (value < min ? value : min), 0n);
  const scale = maxPositive > -maxNegative ? maxPositive : -maxNegative;

  /** Bar height in pixels; 3px keeps a near-zero month visible. */
  const heightOf = (value: bigint): number => {
    if (scale === 0n) return 0;
    const magnitude = value < 0n ? -value : value;
    const ratio = Number((magnitude * 1000n) / scale) / 1000;
    return Math.max(Math.round(ratio * (CHART_HEIGHT / 2)), value === 0n ? 0 : 3);
  };

  const best = values.reduce((max, value) => (value > max ? value : max), values[0] ?? 0n);

  /** Native tooltip: the month's full story, including what the bar omits. */
  const tooltip = (point: MonthlyProfitPoint): string =>
    [
      formatMonth(point.month),
      `${t('finance.incomes')}: ${formatTiyin(point.income)}`,
      `${t('finance.expenses')}: ${formatTiyin(point.expenses)}`,
      `${t('dashboard.netProfit')}: ${formatTiyin(point.profit)}`,
    ].join(' · ');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-headline font-semibold">{t('dashboard.profitChart')}</h2>
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: t('dashboard.viewChart') },
            { value: 'table', label: t('dashboard.viewTable') },
          ]}
        />
      </div>

      {view === 'table' ? (
        <Table
          headers={[
            t('dashboard.month'),
            t('finance.incomes'),
            t('finance.expenses'),
            t('dashboard.netProfit'),
          ]}
        >
          {points.map((point) => (
            <Row key={point.month}>
              <Cell numeric>{formatMonth(point.month)}</Cell>
              <Cell numeric>{formatTiyin(point.income)}</Cell>
              <Cell numeric>{formatTiyin(point.expenses)}</Cell>
              <Cell
                numeric
                className={BigInt(point.profit) < 0n ? 'text-danger' : 'text-ink font-semibold'}
              >
                {formatTiyin(point.profit)}
              </Cell>
            </Row>
          ))}
        </Table>
      ) : (
        <figure
          className="m-0"
          role="img"
          aria-label={t('dashboard.profitChartAria', { count: points.length })}
        >
          <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
            {points.map((point) => {
              const profit = BigInt(point.profit);
              const negative = profit < 0n;
              const height = heightOf(profit);
              const isBest = profit === best && profit > 0n;

              return (
                <div key={point.month} className="group flex min-w-[26px] flex-1 flex-col gap-1.5">
                  {/* Above the zero line */}
                  <div
                    className="flex items-end justify-center"
                    style={{ height: CHART_HEIGHT / 2 }}
                  >
                    {!negative && (
                      <div
                        className="w-full rounded-t-[4px] bg-brand-primary transition-opacity duration-[var(--duration-fast)] ease-ios group-hover:opacity-80"
                        style={{ height }}
                        title={tooltip(point)}
                      />
                    )}
                  </div>
                  <div className="h-px w-full bg-line" aria-hidden="true" />
                  {/* Below the zero line */}
                  <div
                    className="flex items-start justify-center"
                    style={{ height: CHART_HEIGHT / 2 }}
                  >
                    {negative && (
                      <div
                        className="w-full rounded-b-[4px] bg-danger transition-opacity duration-[var(--duration-fast)] ease-ios group-hover:opacity-80"
                        style={{ height }}
                        title={tooltip(point)}
                      />
                    )}
                  </div>
                  <div
                    className={cn(
                      'text-center font-mono text-[10px] tabular-nums',
                      isBest ? 'font-semibold text-ink' : 'text-ink-tertiary',
                    )}
                  >
                    {point.month.slice(5)}
                  </div>
                </div>
              );
            })}
          </div>
          <figcaption className="mt-3 flex flex-wrap items-center gap-4 text-footnote text-ink-secondary">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-brand-primary" aria-hidden="true" />
              {t('dashboard.monthInProfit')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[2px] bg-danger" aria-hidden="true" />
              {t('dashboard.monthInLoss')}
            </span>
            <span className="ml-auto font-mono text-caption text-ink-tertiary">
              {t('dashboard.chartScale')}: {formatTiyin(scale.toString())} {t('common.som')}
            </span>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
