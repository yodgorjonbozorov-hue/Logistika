import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TripStatus } from 'shared';
import { useAllTrips } from '../../shared/api/queries';
import {
  Card,
  Cell,
  EmptyState,
  ErrorMessage,
  PageHeader,
  Row,
  Spinner,
  StatusChip,
  Table,
  CardList,
  ListCard,
  ListState,
  MetaItem,
} from '../../shared/ui';
import { TRIP_STATUS_TONE } from '../../shared/utils/status';

/**
 * Cargo is a property of a trip in the schema rather than its own resource, so
 * this board is the trip list read cargo-first: one row per trip that carries a
 * named load, newest first.
 */
export function CargoPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, error } = useAllTrips();

  const rows = useMemo(
    () => (data ?? []).filter((trip) => trip.cargoName && trip.status !== TripStatus.CANCELLED),
    [data],
  );

  return (
    <div>
      <PageHeader title={t('cargo.title')} subtitle={t('cargo.subtitle')} />
      <ErrorMessage error={error} />

      {/* Mobile: the load and where it is going, then the trip it belongs to. */}
      <div className="md:hidden">
        <ListState isLoading={isLoading} error={error} isEmpty={rows.length === 0}>
          <CardList>
            {rows.map((trip) => (
              <ListCard
                key={trip.id}
                onClick={() => navigate(`/trips/${trip.id}`)}
                title={trip.cargoName ?? '—'}
                subtitle={`${trip.loadingAddress ?? '—'} → ${trip.unloadingAddress ?? '—'}`}
                trailing={
                  <StatusChip tone={TRIP_STATUS_TONE[trip.status]}>
                    {t(`status.${trip.status}`)}
                  </StatusChip>
                }
                meta={
                  <>
                    <MetaItem label={t('cargo.weight')}>
                      {trip.cargoWeight ? `${trip.cargoWeight} ${t('common.ton')}` : '—'}
                    </MetaItem>
                    <MetaItem label={t('cargo.volume')}>
                      {trip.cargoVolume ? `${trip.cargoVolume} m³` : '—'}
                    </MetaItem>
                    <MetaItem label={t('trips.client')}>{trip.client?.name ?? '—'}</MetaItem>
                    <MetaItem label={t('trips.number')}>
                      <span className="tabular-nums text-accent-300">{trip.tripNumber}</span>
                    </MetaItem>
                  </>
                }
              />
            ))}
          </CardList>
        </ListState>
      </div>

      <Card className="hidden overflow-hidden p-0 md:block">
        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="pl-[18px]">{t('cargo.name')}</th>
                <th className="text-right">{t('cargo.weight')}</th>
                <th className="pl-4">{t('cargo.volume')}</th>
                <th>{t('trips.client')}</th>
                <th>{t('trips.route')}</th>
                <th>{t('trips.number')}</th>
                <th>{t('trips.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((trip) => (
                <Row key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)}>
                  <Cell className="pl-[18px] font-medium">{trip.cargoName}</Cell>
                  <Cell align="right">
                    {trip.cargoWeight ? `${trip.cargoWeight} ${t('common.ton')}` : '—'}
                  </Cell>
                  <Cell className="pl-4 text-neutral-400">
                    {trip.cargoVolume ? `${trip.cargoVolume} m³` : '—'}
                  </Cell>
                  <Cell className="whitespace-nowrap">{trip.client?.name ?? '—'}</Cell>
                  <Cell className="whitespace-nowrap text-neutral-400">
                    {trip.loadingAddress ?? '—'} → {trip.unloadingAddress ?? '—'}
                  </Cell>
                  <Cell className="font-medium tabular-nums text-accent-300">
                    {trip.tripNumber}
                  </Cell>
                  <Cell>
                    <StatusChip tone={TRIP_STATUS_TONE[trip.status]}>
                      {t(`status.${trip.status}`)}
                    </StatusChip>
                  </Cell>
                </Row>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
