import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TripStatus } from 'shared';
import type { Trip } from '../../shared/api/entities';
import { useAuth } from '../../shared/auth/AuthContext';
import { can } from '../../shared/auth/permissions';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  Toolbar,
  type Column,
} from '../../shared/ui';
import { Icon } from '../../shared/ui/icons';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import { StatusBadge } from './StatusBadge';
import { useRefLists, useTrips } from './api';

const EMPTY_FILTER = {
  status: '' as TripStatus | '',
  driverId: '',
  vehicleId: '',
  clientId: '',
  from: '',
  to: '',
};

/** Client-side narrowing of the loaded page — the API has no full-text search yet.
 *  TODO: backend `GET /trips?q=` (trip number, client, route) for cross-page search. */
function matchesTerm(trip: Trip, term: string): boolean {
  if (!term) return true;
  const haystack = [
    trip.tripNumber,
    trip.client?.name,
    trip.cargoName,
    trip.loadingAddress,
    trip.unloadingAddress,
    trip.driver?.fullName,
    trip.vehicle?.plateNumber,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(term.toLowerCase());
}

export function TripsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState(EMPTY_FILTER);

  const term = searchParams.get('q') ?? '';
  const { vehicles, drivers, clients } = useRefLists();

  const { data, isLoading, error } = useTrips({
    page,
    status: filter.status || undefined,
    driverId: filter.driverId || undefined,
    vehicleId: filter.vehicleId || undefined,
    clientId: filter.clientId || undefined,
    from: filter.from ? new Date(filter.from).toISOString() : undefined,
    to: filter.to ? new Date(`${filter.to}T23:59:59`).toISOString() : undefined,
  });

  const total = data?.meta?.pagination?.total ?? 0;
  const trips = useMemo(
    () => (data?.data ?? []).filter((trip) => matchesTerm(trip, term)),
    [data, term],
  );

  const set = (key: keyof typeof filter) => (event: { target: { value: string } }) => {
    setFilter((current) => ({ ...current, [key]: event.target.value }));
    setPage(1);
  };

  const hasFilters = Object.values(filter).some(Boolean) || Boolean(term);

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
    { key: 'client', header: t('trips.client'), cell: (trip) => trip.client?.name ?? '—' },
    {
      key: 'route',
      header: t('trips.route'),
      cell: (trip) => (
        <span className="block max-w-[22rem] truncate">
          {trip.loadingAddress ?? '—'} → {trip.unloadingAddress ?? '—'}
        </span>
      ),
    },
    { key: 'driver', header: t('trips.driver'), cell: (trip) => trip.driver?.fullName ?? '—' },
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
        title={t('trips.title')}
        subtitle={t('trips.subtitle')}
        actions={
          can(role, 'createTrip') ? (
            <Button onClick={() => navigate('/trips/new')}>
              <Icon name="plus" className="h-4 w-4" />
              {t('trips.new')}
            </Button>
          ) : null
        }
      />

      <Toolbar>
        <div className="w-full sm:w-56">
          <Field label={t('common.search')}>
            <Input
              value={term}
              placeholder={t('common.searchPlaceholder')}
              onChange={(event) => {
                const next = event.target.value;
                setSearchParams(next ? { q: next } : {}, { replace: true });
              }}
            />
          </Field>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Field label={t('trips.filterStatus')}>
            <Select value={filter.status} onChange={set('status')}>
              <option value="">{t('common.all')}</option>
              {Object.values(TripStatus).map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Field label={t('trips.filterDriver')}>
            <Select value={filter.driverId} onChange={set('driverId')}>
              <option value="">{t('common.all')}</option>
              {(drivers.data ?? []).map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Field label={t('trips.filterVehicle')}>
            <Select value={filter.vehicleId} onChange={set('vehicleId')}>
              <option value="">{t('common.all')}</option>
              {(vehicles.data ?? []).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plateNumber}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Field label={t('trips.filterClient')}>
            <Select value={filter.clientId} onChange={set('clientId')}>
              <option value="">{t('common.all')}</option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-40">
          <Field label={t('common.from')}>
            <Input type="date" value={filter.from} onChange={set('from')} />
          </Field>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-40">
          <Field label={t('common.to')}>
            <Input type="date" value={filter.to} onChange={set('to')} />
          </Field>
        </div>
        {hasFilters ? (
          <Button
            variant="ghost"
            onClick={() => {
              setFilter(EMPTY_FILTER);
              setSearchParams({}, { replace: true });
              setPage(1);
            }}
          >
            {t('common.reset')}
          </Button>
        ) : null}
      </Toolbar>

      <ErrorMessage error={error} />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <DataTable
            rows={trips}
            columns={columns}
            getKey={(trip) => trip.id}
            onRowClick={(trip) => navigate(`/trips/${trip.id}`)}
            empty={
              <EmptyState
                hint={t('trips.emptyHint')}
                action={
                  can(role, 'createTrip') ? (
                    <Button onClick={() => navigate('/trips/new')}>{t('trips.new')}</Button>
                  ) : null
                }
              />
            }
          />
          {!term ? <Pagination page={page} limit={20} total={total} onPage={setPage} /> : null}
        </>
      )}
    </div>
  );
}
