import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api/client';
import type { Driver, Trip } from '../../shared/api/entities';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorMessage,
  PageHeader,
  SectionTitle,
  Skeleton,
  type Column,
} from '../../shared/ui';
import { Icon } from '../../shared/ui/icons';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import { StatusBadge } from '../trips/StatusBadge';
import { formatSalary } from './DriversPage';

const ACTIVE_STATUSES = ['ASSIGNED', 'IN_PROGRESS'];

export function DriverDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const driver = useQuery({
    queryKey: ['drivers', id],
    queryFn: async () => (await api<Driver>(`/drivers/${id}`)).data,
    enabled: Boolean(id),
  });

  const trips = useQuery({
    queryKey: ['trips', { driverId: id, limit: 50 }],
    queryFn: async () => (await api<Trip[]>('/trips', { query: { driverId: id, limit: 50 } })).data,
    enabled: Boolean(id),
  });

  if (driver.isLoading) return <Skeleton className="h-64" />;
  if (driver.error || !driver.data) return <ErrorMessage error={driver.error} />;

  const person = driver.data;
  const activeTrip = (trips.data ?? []).find((trip) => ACTIVE_STATUSES.includes(trip.status));

  const columns: Array<Column<Trip>> = [
    {
      key: 'number',
      header: t('trips.number'),
      primary: true,
      cell: (trip) => <span className="whitespace-nowrap">{trip.tripNumber}</span>,
    },
    {
      key: 'status',
      header: t('trips.status'),
      secondary: true,
      cell: (trip) => <StatusBadge status={trip.status} />,
    },
    {
      key: 'route',
      header: t('trips.route'),
      cell: (trip) => `${trip.loadingAddress ?? '—'} → ${trip.unloadingAddress ?? '—'}`,
    },
    {
      key: 'vehicle',
      header: t('trips.vehicle'),
      cell: (trip) => trip.vehicle?.plateNumber ?? '—',
    },
    {
      key: 'price',
      header: t('trips.price'),
      className: 'money',
      cell: (trip) => formatTiyin(trip.agreedPrice),
    },
    { key: 'date', header: t('trips.date'), cell: (trip) => formatDate(trip.createdAt) },
  ];

  return (
    <div>
      <PageHeader
        title={person.fullName}
        subtitle={t('drivers.detailTitle')}
        actions={
          <Button variant="secondary" onClick={() => navigate('/drivers')}>
            <Icon name="chevronLeft" className="h-4 w-4" />
            {t('common.back')}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3">
            <Badge tone={person.isActive ? 'green' : 'gray'}>
              {person.isActive ? t('common.active') : t('common.inactive')}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
            <Detail label={t('drivers.phone')}>{person.phone ?? '—'}</Detail>
            <Detail label={t('drivers.license')}>{person.licenseNumber ?? '—'}</Detail>
            <Detail label={t('drivers.licenseExpiry')}>{formatDate(person.licenseExpiry)}</Detail>
            <Detail label={t('drivers.hireDate')}>{formatDate(person.hireDate)}</Detail>
            <Detail label={t('drivers.salaryType')}>
              {person.salaryType ? t(`drivers.salaryTypes.${person.salaryType}`) : '—'}
            </Detail>
            <Detail label={t('drivers.salaryValue')}>{formatSalary(person)}</Detail>
          </dl>
        </Card>

        <Card>
          <SectionTitle>{t('drivers.activeTrip')}</SectionTitle>
          {activeTrip ? (
            <button
              onClick={() => navigate(`/trips/${activeTrip.id}`)}
              className="w-full rounded-lg border border-line p-3 text-left hover:bg-surface-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{activeTrip.tripNumber}</span>
                <StatusBadge status={activeTrip.status} />
              </div>
              <div className="mt-1 truncate text-xs text-ink-2">
                {activeTrip.loadingAddress ?? '—'} → {activeTrip.unloadingAddress ?? '—'}
              </div>
              <div className="mt-1 text-xs text-ink-2">
                {t('drivers.vehicle')}: {activeTrip.vehicle?.plateNumber ?? '—'}
              </div>
            </button>
          ) : (
            <p className="text-sm text-ink-2">{t('drivers.noActiveTrip')}</p>
          )}
        </Card>
      </div>

      <section className="mt-6">
        <SectionTitle>{t('drivers.tripHistory')}</SectionTitle>
        {trips.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <DataTable
            rows={trips.data ?? []}
            columns={columns}
            getKey={(trip) => trip.id}
            onRowClick={(trip) => navigate(`/trips/${trip.id}`)}
            empty={<EmptyState />}
          />
        )}
      </section>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-ink-2">{label}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  );
}
