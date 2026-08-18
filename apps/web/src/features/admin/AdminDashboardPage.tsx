import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/client';
import type { AdminCompany, AdminStats } from '../../shared/api/entities';
import {
  Badge,
  Card,
  ComingSoon,
  DataTable,
  ErrorMessage,
  KpiCard,
  PageHeader,
  SectionTitle,
  Skeleton,
  type Column,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';

const RECENT_LIMIT = 5;

export function AdminDashboardPage() {
  const { t } = useTranslation();

  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => (await api<AdminStats>('/admin/companies/stats')).data,
  });

  const companies = useQuery({
    queryKey: ['admin', 'companies', { limit: RECENT_LIMIT }],
    queryFn: async () =>
      (await api<AdminCompany[]>('/admin/companies', { query: { limit: RECENT_LIMIT } })).data,
  });

  const columns: Array<Column<AdminCompany>> = [
    { key: 'name', header: t('admin.company'), primary: true, cell: (row) => row.name },
    {
      key: 'status',
      header: t('admin.status'),
      secondary: true,
      cell: (row) => (
        <Badge tone={row.isActive ? 'green' : 'gray'}>
          {row.isActive ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    {
      key: 'owner',
      header: t('admin.owner'),
      cell: (row) => row.owner?.fullName ?? t('admin.noOwner'),
    },
    {
      key: 'users',
      header: t('admin.userCount'),
      className: 'money',
      cell: (row) => row.userCount,
    },
    {
      key: 'trips',
      header: t('admin.tripCount'),
      className: 'money',
      cell: (row) => row.tripCount,
    },
    { key: 'created', header: t('admin.created'), cell: (row) => formatDate(row.createdAt) },
  ];

  return (
    <div>
      <PageHeader title={t('admin.title')} subtitle={t('admin.subtitle')} />

      <ErrorMessage error={stats.error} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {stats.isLoading || !stats.data
          ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24" />)
          : [
              { label: t('admin.companies'), value: stats.data.companies },
              { label: t('admin.activeCompanies'), value: stats.data.activeCompanies },
              { label: t('admin.trialCompanies'), value: stats.data.trialCompanies },
              {
                label: t('admin.expiredCompanies'),
                value: stats.data.expiredCompanies,
                tone: 'danger' as const,
              },
              { label: t('admin.users'), value: stats.data.users },
              { label: t('admin.trips'), value: stats.data.trips },
            ].map((card) => (
              <KpiCard key={card.label} label={card.label} value={card.value} tone={card.tone} />
            ))}
      </div>

      <section className="mt-6">
        <SectionTitle
          action={
            <Link to="/admin/companies" className="text-sm text-accent hover:underline">
              {t('dashboard.seeAll')}
            </Link>
          }
        >
          {t('admin.companiesTitle')}
        </SectionTitle>
        {companies.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <DataTable rows={companies.data ?? []} columns={columns} getKey={(row) => row.id} />
        )}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>{t('admin.users')}</SectionTitle>
          {/* No platform-wide user endpoint exists yet — nothing is invented here.
              TODO: backend `GET /admin/users` (cross-tenant, paginated). */}
          <ComingSoon note={t('admin.usersNote')} />
        </Card>
        <Card>
          <SectionTitle>{t('nav.settings')}</SectionTitle>
          {/* TODO: backend `GET /admin/system` (queue depth, storage, job health). */}
          <ComingSoon note={t('admin.systemNote')} />
        </Card>
      </section>
    </div>
  );
}
