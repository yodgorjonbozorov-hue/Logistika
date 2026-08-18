import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api/client';
import { Card, EmptyState, ErrorMessage, Select, TableSkeleton } from '../../shared/ui';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

const ENTITY_TYPES = ['Trip', 'Expense', 'Income', 'Driver', 'Vehicle', 'Client', 'User'];

/** Fields whose change is worth showing without opening the whole row. */
function changedFields(row: AuditRow): string[] {
  if (!row.before || !row.after) return [];
  return Object.keys(row.after).filter(
    (key) => JSON.stringify(row.before?.[key]) !== JSON.stringify(row.after?.[key]),
  );
}

/** OWNER-only view of who changed what (TZ §9). */
export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const [entityType, setEntityType] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-logs', entityType],
    queryFn: async () =>
      (await api<AuditRow[]>('/audit-logs', { query: { entityType, limit: 100 } })).data,
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-navy dark:text-white">{t('audit.title')}</h1>
        <Select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          <option value="">{t('audit.allTypes')}</option>
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </div>

      <ErrorMessage error={error} />
      {isLoading ? (
        <TableSkeleton columns={5} />
      ) : (data ?? []).length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted dark:border-white/10">
                <th scope="col" className="py-2 pr-4">
                  {t('audit.when')}
                </th>
                <th scope="col" className="py-2 pr-4">
                  {t('audit.action')}
                </th>
                <th scope="col" className="py-2 pr-4">
                  {t('audit.entity')}
                </th>
                <th scope="col" className="py-2">
                  {t('audit.changed')}
                </th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((row) => (
                <tr key={row.id} className="border-b last:border-0 dark:border-white/5">
                  <td className="whitespace-nowrap py-2 pr-4 text-muted">
                    {new Date(row.createdAt).toLocaleString(i18n.language)}
                  </td>
                  <td className="py-2 pr-4 font-medium">{row.action}</td>
                  <td className="py-2 pr-4">{row.entityType}</td>
                  <td className="py-2 text-muted">{changedFields(row).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
