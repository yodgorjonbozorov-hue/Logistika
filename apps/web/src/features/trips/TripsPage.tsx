import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TripStatus } from 'shared';
import { useDrivers, useTripPage, useVehicles } from '../../shared/api/queries';
import {
  Button,
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  Icon,
  PageHeader,
  Pagination,
  Row,
  Select,
  Spinner,
  StatusChip,
  Table,
} from '../../shared/ui';
import { formatDate } from '../../shared/utils/date';
import { formatTiyin } from '../../shared/utils/money';
import { TRIP_STATUS_TONE } from '../../shared/utils/status';
import { RouteCell } from '../overview/OverviewPage';

const PAGE_SIZE = 10;

export function TripsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<TripStatus | ''>('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [search, setSearch] = useState('');

  const vehicles = useVehicles();
  const drivers = useDrivers();
  const { data, isLoading, error } = useTripPage({
    page,
    limit: PAGE_SIZE,
    status,
    vehicleId,
    driverId,
  });

  const total = data?.meta?.pagination?.total ?? 0;
  const rows = (data?.data ?? []).filter((trip) =>
    search ? trip.tripNumber.toLowerCase().includes(search.toLowerCase()) : true,
  );

  function reset() {
    setStatus('');
    setVehicleId('');
    setDriverId('');
    setSearch('');
    setPage(1);
  }

  function onFilter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <div>
      <PageHeader
        title={t('trips.title')}
        subtitle={t('trips.subtitle', { count: total })}
        actions={
          <>
            <Button variant="secondary" icon="export">
              {t('common.export')}
            </Button>
            <Button icon="plus" onClick={() => navigate('/trips/new')}>
              {t('trips.new')}
            </Button>
          </>
        }
      />

      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <label className="flex w-[230px] items-center gap-2 rounded-md border border-neutral-800 px-[11px] py-[7px] text-[13px] text-neutral-500 focus-within:border-neutral-700">
          <Icon name="magnifying-glass" size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('trips.searchPlaceholder')}
            aria-label={t('trips.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-neutral-500"
          />
        </label>

        <Select
          className="w-auto py-[7px] text-[13px]"
          aria-label={t('trips.status')}
          value={status}
          onChange={(e) => onFilter(setStatus)(e.target.value as TripStatus | '')}
        >
          <option value="">
            {t('trips.status')}: {t('common.all')}
          </option>
          {Object.values(TripStatus).map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}`)}
            </option>
          ))}
        </Select>

        <Select
          className="w-auto py-[7px] text-[13px]"
          aria-label={t('trips.driver')}
          value={driverId}
          onChange={(e) => onFilter(setDriverId)(e.target.value)}
        >
          <option value="">
            {t('trips.driver')}: {t('common.all')}
          </option>
          {(drivers.data ?? []).map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.fullName}
            </option>
          ))}
        </Select>

        <Select
          className="w-auto py-[7px] text-[13px]"
          aria-label={t('trips.vehicle')}
          value={vehicleId}
          onChange={(e) => onFilter(setVehicleId)(e.target.value)}
        >
          <option value="">
            {t('trips.vehicle')}: {t('common.all')}
          </option>
          {(vehicles.data ?? []).map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.plateNumber}
            </option>
          ))}
        </Select>

        <Button variant="ghost" className="text-[12.5px]" onClick={reset}>
          {t('common.clear')}
        </Button>
      </div>

      <ErrorMessage error={error} />

      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="pl-[18px]">{t('trips.number')}</th>
                <th>{t('finance.date')}</th>
                <th>{t('trips.vehicle')}</th>
                <th>{t('trips.driver')}</th>
                <th>{t('trips.route')}</th>
                <th>{t('trips.cargoName')}</th>
                <th className="text-right">{t('trips.priceShort')}</th>
                <th className="pl-4">{t('trips.status')}</th>
                <th className="pr-[18px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((trip) => (
                <Row key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)}>
                  <Cell className="pl-[18px] font-semibold tabular-nums text-accent-300">
                    {trip.tripNumber}
                  </Cell>
                  <Cell className="whitespace-nowrap text-neutral-400">
                    {formatDate(trip.loadingDate ?? trip.createdAt)}
                  </Cell>
                  <Cell className="whitespace-nowrap font-medium">
                    {trip.vehicle?.plateNumber ?? '—'}
                  </Cell>
                  <Cell className="whitespace-nowrap">{trip.driver?.fullName ?? '—'}</Cell>
                  <Cell>
                    <RouteCell from={trip.loadingAddress} to={trip.unloadingAddress} />
                  </Cell>
                  <Cell>
                    <div className="whitespace-nowrap">{trip.cargoName ?? '—'}</div>
                    <div className="text-[11.5px] text-neutral-500">
                      {trip.cargoWeight ? `${trip.cargoWeight} ${t('common.ton')}` : ''}
                    </div>
                  </Cell>
                  <Cell align="right" className="whitespace-nowrap">
                    {formatTiyin(trip.agreedPrice)}
                  </Cell>
                  <Cell className="pl-4">
                    <StatusChip tone={TRIP_STATUS_TONE[trip.status]}>
                      {t(`status.${trip.status}`)}
                    </StatusChip>
                  </Cell>
                  <Cell className="pr-[18px] text-right">
                    <Icon
                      name="dots-three"
                      size={16}
                      style={{ color: 'var(--color-neutral-500)' }}
                    />
                  </Cell>
                </Row>
              ))}
            </tbody>
          </Table>
        )}
        {total > 0 ? (
          <Pagination
            page={page}
            limit={PAGE_SIZE}
            total={total}
            onPage={setPage}
            label={t('trips.paginationLabel', {
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, total),
              total,
            })}
          />
        ) : null}
      </Card>
    </div>
  );
}
