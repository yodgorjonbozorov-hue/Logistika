import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api/client';
import type { GpsPoint, Trip, Vehicle } from '../../shared/api/entities';
import {
  Badge,
  Button,
  Card,
  ComingSoon,
  DataTable,
  EmptyState,
  ErrorMessage,
  PageHeader,
  Skeleton,
  Tabs,
  type Column,
} from '../../shared/ui';
import { Icon } from '../../shared/ui/icons';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import { TrackMap } from '../map/TrackMap';
import { StatusBadge } from '../trips/StatusBadge';

type Tab = 'trips' | 'gps' | 'maintenance' | 'documents';

const GPS_WINDOW_DAYS = 7;

export function VehicleDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('trips');

  const vehicle = useQuery({
    queryKey: ['vehicles', id],
    queryFn: async () => (await api<Vehicle>(`/vehicles/${id}`)).data,
    enabled: Boolean(id),
  });

  const trips = useQuery({
    queryKey: ['trips', { vehicleId: id, limit: 50 }],
    queryFn: async () =>
      (await api<Trip[]>('/trips', { query: { vehicleId: id, limit: 50 } })).data,
    enabled: Boolean(id),
  });

  if (vehicle.isLoading) return <Skeleton className="h-64" />;
  if (vehicle.error || !vehicle.data) return <ErrorMessage error={vehicle.error} />;

  const unit = vehicle.data;

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
    { key: 'driver', header: t('trips.driver'), cell: (trip) => trip.driver?.fullName ?? '—' },
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
        title={unit.plateNumber}
        subtitle={[unit.brand, unit.model].filter(Boolean).join(' ') || t('vehicles.detailTitle')}
        actions={
          <Button variant="secondary" onClick={() => navigate('/vehicles')}>
            <Icon name="chevronLeft" className="h-4 w-4" />
            {t('common.back')}
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge tone={unit.isActive ? 'green' : 'gray'}>
            {unit.isActive ? t('common.active') : t('common.inactive')}
          </Badge>
          <Badge tone="gray">{t(`vehicles.types.${unit.type}`)}</Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <Detail label={t('vehicles.year')}>{unit.year ?? '—'}</Detail>
          <Detail label={t('vehicles.vin')}>{unit.vin ?? '—'}</Detail>
          <Detail label={t('vehicles.fuelNorm')}>{unit.fuelNormPer100km ?? '—'}</Detail>
          <Detail label={t('vehicles.odometer')}>{unit.currentOdometer ?? '—'}</Detail>
          <Detail label={t('vehicles.insuranceExpiry')}>{formatDate(unit.insuranceExpiry)}</Detail>
          <Detail label={t('vehicles.techExpiry')}>{formatDate(unit.techInspectionExpiry)}</Detail>
        </dl>
      </Card>

      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'trips', label: t('vehicles.tabs.trips') },
          { key: 'gps', label: t('vehicles.tabs.gps') },
          { key: 'maintenance', label: t('vehicles.tabs.maintenance') },
          { key: 'documents', label: t('vehicles.tabs.documents') },
        ]}
      />

      {tab === 'trips' &&
        (trips.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <DataTable
            rows={trips.data ?? []}
            columns={columns}
            getKey={(trip) => trip.id}
            onRowClick={(trip) => navigate(`/trips/${trip.id}`)}
            empty={<EmptyState />}
          />
        ))}
      {tab === 'gps' && <VehicleTrack vehicleId={id} />}
      {tab === 'maintenance' && <ComingSoon note={t('vehicles.maintenanceNote')} />}
      {tab === 'documents' && <ComingSoon note={t('vehicles.documentsNote')} />}
    </div>
  );
}

function VehicleTrack({ vehicleId }: { vehicleId: string }) {
  const { t } = useTranslation();
  const to = new Date();
  const from = new Date(to.getTime() - GPS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const { data, isLoading } = useQuery({
    queryKey: ['tracking', 'history', vehicleId, 'week'],
    queryFn: async () =>
      (
        await api<GpsPoint[]>(`/tracking/vehicles/${vehicleId}/history`, {
          query: { from: from.toISOString(), to: to.toISOString() },
        })
      ).data,
    enabled: Boolean(vehicleId),
  });

  if (isLoading) return <Skeleton className="h-80" />;
  if ((data ?? []).length === 0) return <EmptyState hint={t('map.noTrack')} />;
  return <TrackMap points={data ?? []} />;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-ink-2">{label}</dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  );
}
