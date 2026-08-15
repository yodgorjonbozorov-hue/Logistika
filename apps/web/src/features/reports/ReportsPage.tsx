import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useReport,
  type Period,
  type ReportColumnType,
  type ReportTable,
} from '../../shared/api/analytics';
import { tokenStore } from '../../shared/api/client';
import {
  Button,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  PageHeader,
  Row,
  Spinner,
  Table,
} from '../../shared/ui';
import { PeriodPicker, ShareBars } from '../../shared/ui/stats';
import { formatDate } from '../../shared/utils/date';
import { currentMonthPeriod, formatBp, formatDecimal } from '../../shared/utils/format';
import { formatTiyin } from '../../shared/utils/money';

const REPORT_KEYS = ['trips', 'vehicles', 'routes', 'drivers', 'clients', 'expenses'] as const;
type ReportKey = (typeof REPORT_KEYS)[number];

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

/** One cell rendered by its declared type — money in tiyin, ratios in basis points. */
export function renderCell(value: string | number | null, type: ReportColumnType): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'money':
      return formatTiyin(String(value));
    case 'percent':
      return formatBp(Number(value));
    case 'km':
      return formatDecimal(value, 1);
    case 'litres':
      return formatDecimal(value, 2);
    case 'number':
      return String(value);
    case 'date':
      return formatDate(String(value));
    default:
      return String(value);
  }
}

export function ReportsPage() {
  const { t } = useTranslation();
  const [key, setKey] = useState<ReportKey>('trips');
  const [period, setPeriod] = useState<Period>(() => currentMonthPeriod());
  const { data, isLoading, error } = useReport(key, period);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('reports.title')}
        actions={
          <div className="no-print flex items-end gap-3">
            <PeriodPicker period={period} onChange={setPeriod} />
            <ExportButtons reportKey={key} period={period} />
          </div>
        }
      />

      <div className="no-print flex flex-wrap gap-2">
        {REPORT_KEYS.map((reportKey) => (
          <button
            key={reportKey}
            onClick={() => setKey(reportKey)}
            className={
              key === reportKey
                ? 'rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-navy'
                : 'rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-muted hover:bg-gray-50 dark:border-white/20 dark:hover:bg-white/10'
            }
          >
            {t(`reports.keys.${reportKey}`)}
          </button>
        ))}
      </div>

      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : data ? (
        <div className="print-area">
          <h2 className="mb-2 hidden text-lg font-bold print:block">{t(data.titleKey)}</h2>
          <ReportView table={data} />
        </div>
      ) : null}
    </div>
  );
}

function ReportView({ table }: { table: ReportTable }) {
  const { t } = useTranslation();
  if (table.rows.length === 0) return <EmptyState />;

  return (
    <div className="space-y-4">
      {table.key === 'expenses' ? (
        <Card>
          <ShareBars
            rows={table.rows.map((row) => ({
              label: t(`finance.categories.${String(row.category)}`),
              amount: String(row.amount ?? '0'),
              shareBp: row.shareBp === null ? null : Number(row.shareBp),
            }))}
          />
        </Card>
      ) : null}

      <Table headers={table.columns.map((column) => t(column.labelKey))}>
        {table.rows.map((row, index) => (
          <Row key={index}>
            {table.columns.map((column) => (
              <Cell
                key={column.key}
                className={column.type === 'text' ? undefined : 'tabular-nums'}
              >
                {column.key === 'category'
                  ? t(`finance.categories.${String(row[column.key])}`)
                  : renderCell(row[column.key] ?? null, column.type)}
              </Cell>
            ))}
          </Row>
        ))}
        {table.totals ? (
          <Row>
            {table.columns.map((column) => (
              <Cell key={column.key} className="font-semibold tabular-nums">
                {renderCell(table.totals?.[column.key] ?? null, column.type)}
              </Cell>
            ))}
          </Row>
        ) : null}
      </Table>
    </div>
  );
}

/**
 * The export endpoint streams a file, so it is fetched with the access token and
 * handed to the browser as a blob — a plain link could not carry the header.
 */
function ExportButtons({ reportKey, period }: { reportKey: string; period: Period }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function download(format: 'xlsx' | 'csv') {
    setBusy(true);
    setError(null);
    try {
      const url = new URL(`${API_URL}/reports/${reportKey}/export`, window.location.origin);
      url.searchParams.set('format', format);
      url.searchParams.set('from', period.from);
      url.searchParams.set('to', period.to);

      const response = await fetch(url.toString(), {
        headers: {
          authorization: `Bearer ${tokenStore.access ?? ''}`,
          'accept-language': document.documentElement.lang || 'uz-latn',
        },
      });
      if (!response.ok) throw new Error(t('common.errorGeneric'));

      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${reportKey}.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(t('common.errorGeneric')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void download('xlsx')}>
          {t('reports.exportExcel')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void download('csv')}>
          {t('reports.exportCsv')}
        </Button>
        {/* PDF is produced by the browser print dialog — it is the only renderer
            that already carries fonts for all three locales. */}
        <Button variant="secondary" onClick={() => window.print()}>
          {t('reports.exportPdf')}
        </Button>
      </div>
      <ErrorMessage error={error} />
    </div>
  );
}
