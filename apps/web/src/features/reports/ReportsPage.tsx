import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, apiDownload } from '../../shared/api/client';
import type { ExpenseStructureRow, ProfitRow } from '../../shared/api/entities';
import {
  Button,
  Cell,
  EmptyState,
  ErrorMessage,
  Input,
  PageHeader,
  Row,
  Select,
  Spinner,
  Table,
} from '../../shared/ui';
import { dateInputToIso } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';

const GROUPS = ['trip', 'vehicle', 'route', 'driver', 'client', 'expense-structure'] as const;
type Group = (typeof GROUPS)[number];

function monthStartInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ReportsPage() {
  const { t } = useTranslation();
  const [group, setGroup] = useState<Group>('trip');
  const [from, setFrom] = useState(monthStartInput());
  const [to, setTo] = useState('');
  const [exportError, setExportError] = useState<unknown>(null);

  const query = { from: dateInputToIso(from), to: to ? dateInputToIso(to) : undefined };

  async function download(format: 'xlsx' | 'pdf') {
    setExportError(null);
    try {
      await apiDownload('/reports/export', { report: group, format, ...query });
    } catch (error) {
      setExportError(error);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('reports.title')}
        actions={
          <>
            <Button variant="secondary" onClick={() => void download('xlsx')}>
              ⬇ Excel
            </Button>
            <Button variant="secondary" onClick={() => void download('pdf')}>
              ⬇ PDF
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-64" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
          {GROUPS.map((key) => (
            <option key={key} value={key}>
              {t(`reports.groups.${key}`)}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          className="w-40"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-muted">—</span>
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <ErrorMessage error={exportError} />
      {group === 'expense-structure' ? (
        <ExpenseStructureReport from={query.from} to={query.to} />
      ) : (
        <ProfitReport group={group} from={query.from} to={query.to} />
      )}
    </div>
  );
}

function ProfitReport({ group, from, to }: { group: string; from?: string; to?: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports-profit', { group, from, to }],
    queryFn: () => api<ProfitRow[]>('/reports/profit', { query: { groupBy: group, from, to } }),
  });
  const rows = data?.data ?? [];

  return (
    <div>
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <Table
          headers={[
            t('reports.label'),
            t('reports.tripCount'),
            t('reports.distance'),
            t('reports.income'),
            t('reports.totalCost'),
            t('reports.profit'),
            t('reports.costPerKm'),
            t('reports.roi'),
          ]}
        >
          {rows.map((row) => (
            <Row key={row.key}>
              <Cell className="font-medium">{row.label}</Cell>
              <Cell className="tabular-nums">{row.tripCount}</Cell>
              <Cell className="tabular-nums">{row.distanceKm}</Cell>
              <Cell className="tabular-nums">{formatTiyin(row.income)}</Cell>
              <Cell className="tabular-nums">{formatTiyin(row.totalCost)}</Cell>
              <Cell
                className={
                  'tabular-nums font-semibold ' +
                  (BigInt(row.profit) >= 0n ? 'text-success' : 'text-danger')
                }
              >
                {formatTiyin(row.profit)}
              </Cell>
              <Cell className="tabular-nums">{formatTiyin(row.costPerKm)}</Cell>
              <Cell className="tabular-nums">
                {row.roiPercent == null ? '—' : `${row.roiPercent}%`}
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </div>
  );
}

function ExpenseStructureReport({ from, to }: { from?: string; to?: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports-structure', { from, to }],
    queryFn: () =>
      api<ExpenseStructureRow[]>('/reports/expense-structure', { query: { from, to } }),
  });
  const rows = data?.data ?? [];

  return (
    <div>
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <Table headers={[t('finance.category'), t('finance.amount'), t('reports.share')]}>
          {rows.map((row) => (
            <Row key={row.category}>
              <Cell className="font-medium">{t(`finance.categories.${row.category}`)}</Cell>
              <Cell className="tabular-nums">{formatTiyin(row.amount)}</Cell>
              <Cell>
                <div className="flex items-center gap-2">
                  {/* share bar — magnitude in one hue, value labeled beside it */}
                  <div className="h-2 w-40 overflow-hidden rounded bg-gray-100 dark:bg-white/10">
                    <div
                      className="h-full rounded bg-accent"
                      style={{ width: `${Math.min(row.sharePercent, 100)}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-xs">{row.sharePercent}%</span>
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </div>
  );
}
