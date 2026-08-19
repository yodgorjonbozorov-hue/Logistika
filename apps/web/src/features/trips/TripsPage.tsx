import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TripStatus } from 'shared';
import {
  Button,
  Cell,
  EmptyState,
  ErrorMessage,
  IconPlus,
  PageHeader,
  Pagination,
  Row,
  Select,
  Spinner,
  Table,
} from '../../shared/ui';
import { formatTiyin } from '../../shared/utils/money';
import { StatusBadge } from './StatusBadge';
import { TripFormModal } from './TripForm';
import { useTrips } from './api';

export function TripsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<TripStatus | ''>('');
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, error } = useTrips({ page, status: status || undefined });
  const trips = data?.data ?? [];
  const total = data?.meta?.pagination?.total ?? 0;

  return (
    <div>
      <PageHeader
        title={t('trips.title')}
        subtitle={t('trips.subtitle')}
        actions={
          <>
            <Select
              aria-label={t('trips.status')}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as TripStatus | '');
                setPage(1);
              }}
              className="w-44"
            >
              <option value="">{t('common.all')}</option>
              {Object.values(TripStatus).map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
            <Button onClick={() => setShowForm(true)} icon={<IconPlus size={18} />}>
              {t('trips.new')}
            </Button>
          </>
        }
      />
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : trips.length === 0 ? (
        <EmptyState
          description={t('trips.emptyHint')}
          action={
            <Button onClick={() => setShowForm(true)} icon={<IconPlus size={18} />}>
              {t('trips.new')}
            </Button>
          }
        />
      ) : (
        <>
          <Table
            headers={[
              t('trips.number'),
              t('trips.route'),
              t('trips.client'),
              t('trips.vehicle'),
              t('trips.driver'),
              t('trips.price'),
              t('trips.status'),
            ]}
          >
            {trips.map((trip) => (
              <Row key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)}>
                <Cell numeric className="font-semibold text-ink">
                  №{trip.tripNumber}
                </Cell>
                <Cell className="font-medium">
                  {trip.loadingAddress ?? '—'} → {trip.unloadingAddress ?? '—'}
                </Cell>
                <Cell className="text-ink-secondary">{trip.client?.name ?? '—'}</Cell>
                <Cell className="text-ink-secondary">{trip.vehicle?.plateNumber ?? '—'}</Cell>
                <Cell className="text-ink-secondary">{trip.driver?.fullName ?? '—'}</Cell>
                <Cell numeric>{formatTiyin(trip.agreedPrice)}</Cell>
                <Cell>
                  <StatusBadge status={trip.status} />
                </Cell>
              </Row>
            ))}
          </Table>
          <Pagination page={page} limit={20} total={total} onPage={setPage} />
        </>
      )}
      <TripFormModal open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
