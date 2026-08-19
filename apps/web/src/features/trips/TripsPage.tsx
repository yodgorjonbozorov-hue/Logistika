import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TripStatus } from 'shared';
import { useDrivers, useTripPage, useVehicles } from '../../shared/api/queries';
import {
  Button,
  Card,
  CardList,
  Cell,
  EmptyBlock,
  EmptyState,
  ErrorMessage,
  Field,
  FilterButton,
  FilterSheet,
  Icon,
  ListCard,
  ListState,
  MetaItem,
  PageHeader,
  Pagination,
  Row,
  SearchInput,
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
  const [filtersOpen, setFiltersOpen] = useState(false);

  const vehicles = useVehicles();
  const drivers = useDrivers();
  const { data, isLoading, error, refetch } = useTripPage({
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
  const activeFilters = [status, vehicleId, driverId].filter(Boolean).length;

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

  /** The three selects, shared by the desktop filter row and the mobile sheet. */
  const statusSelect = (
    <Select
      className="w-full py-[7px] text-[13px] md:w-auto"
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
  );

  const driverSelect = (
    <Select
      className="w-full py-[7px] text-[13px] md:w-auto"
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
  );

  const vehicleSelect = (
    <Select
      className="w-full py-[7px] text-[13px] md:w-auto"
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
  );

  return (
    <div>
      <PageHeader
        title={t('trips.title')}
        subtitle={t('trips.subtitle', { count: total })}
        actions={
          <>
            <Button variant="secondary" icon="export" className="hidden md:inline-flex">
              {t('common.export')}
            </Button>
            <Button icon="plus" onClick={() => navigate('/trips/new')}>
              {t('trips.new')}
            </Button>
          </>
        }
      />

      {/* Mobile: search fills the row, filters collapse into a sheet. */}
      <div className="mb-3 flex gap-2 md:hidden">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('trips.searchPlaceholder')}
          className="min-w-0 flex-1"
        />
        <FilterButton count={activeFilters} onClick={() => setFiltersOpen(true)} />
      </div>

      <div className="mb-3.5 hidden flex-wrap items-center gap-2 md:flex">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('trips.searchPlaceholder')}
          className="w-[230px]"
        />
        {statusSelect}
        {driverSelect}
        {vehicleSelect}
        <Button variant="ghost" className="text-[12.5px]" onClick={reset}>
          {t('common.clear')}
        </Button>
      </div>

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        onClear={reset}
        count={activeFilters}
      >
        <Field label={t('trips.status')}>{statusSelect}</Field>
        <Field label={t('trips.driver')}>{driverSelect}</Field>
        <Field label={t('trips.vehicle')}>{vehicleSelect}</Field>
      </FilterSheet>

      <ErrorMessage error={error} />

      {/* Mobile: one card per trip, the number and status first. */}
      <div className="md:hidden">
        <ListState
          isLoading={isLoading}
          error={error}
          isEmpty={rows.length === 0}
          onRetry={() => void refetch()}
          empty={
            <Card>
              <EmptyBlock
                icon="path"
                title={t('trips.emptyTitle')}
                description={t('trips.emptyBody')}
                action={
                  <Button icon="plus" onClick={() => navigate('/trips/new')}>
                    {t('trips.new')}
                  </Button>
                }
              />
            </Card>
          }
        >
          <CardList>
            {rows.map((trip) => (
              <ListCard
                key={trip.id}
                onClick={() => navigate(`/trips/${trip.id}`)}
                title={<span className="tabular-nums text-accent-300">{trip.tripNumber}</span>}
                subtitle={`${trip.loadingAddress ?? '—'} → ${trip.unloadingAddress ?? '—'}`}
                trailing={
                  <StatusChip tone={TRIP_STATUS_TONE[trip.status]}>
                    {t(`status.${trip.status}`)}
                  </StatusChip>
                }
                meta={
                  <>
                    <MetaItem label={t('trips.vehicle')}>
                      {trip.vehicle?.plateNumber ?? '—'}
                    </MetaItem>
                    <MetaItem label={t('trips.driver')}>{trip.driver?.fullName ?? '—'}</MetaItem>
                    <MetaItem label={t('finance.date')}>
                      {formatDate(trip.loadingDate ?? trip.createdAt)}
                    </MetaItem>
                    <MetaItem label={t('trips.priceShort')}>
                      <span className="tabular-nums">{formatTiyin(trip.agreedPrice)}</span>
                    </MetaItem>
                  </>
                }
              />
            ))}
          </CardList>
        </ListState>
        {total > 0 && rows.length > 0 ? (
          <Card className="mt-2 overflow-hidden p-0">
            <TripPagination />
          </Card>
        ) : null}
      </div>

      {/* Desktop: the table, unchanged. */}
      <Card className="hidden overflow-hidden p-0 md:block">
        <ListState
          isLoading={isLoading}
          error={error}
          isEmpty={rows.length === 0}
          onRetry={() => void refetch()}
          skeleton={<Spinner />}
          empty={<EmptyState />}
        >
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
        </ListState>
        {total > 0 ? <TripPagination /> : null}
      </Card>
    </div>
  );

  function TripPagination() {
    return (
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
    );
  }
}
