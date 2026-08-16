import { useTranslation } from 'react-i18next';
import { useDriverRatings, type DriverRating } from '../../shared/api/analytics';
import { Card, Cell, EmptyState, ErrorMessage, Row, Spinner, Table } from '../../shared/ui';
import { formatBp } from '../../shared/utils/format';

/** "4.35" from hundredths of a star; the score is an integer end to end. */
export function formatRating(ratingCentis: number | null): string {
  if (ratingCentis === null) return '—';
  return `${Math.floor(ratingCentis / 100)}.${String(ratingCentis % 100).padStart(2, '0')}`;
}

function tone(ratingCentis: number | null): string {
  if (ratingCentis === null) return 'text-muted';
  if (ratingCentis >= 450) return 'text-success';
  if (ratingCentis >= 350) return '';
  return 'text-danger';
}

/**
 * W-6 rating: lateness, fuel deviation and breakdowns.
 *
 * The three inputs are shown next to the score on purpose — a driver who can
 * see why they lost a star can argue with the record, which is the only way the
 * record gets corrected.
 */
export function RatingCard() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useDriverRatings();
  const ratings = data ?? [];

  return (
    <Card className="mt-4">
      <div className="mb-3 text-sm font-semibold">{t('drivers.rating.title')}</div>
      <p className="mb-3 text-xs text-muted">{t('drivers.rating.hint')}</p>
      <ErrorMessage error={error} />
      {isLoading ? (
        <Spinner />
      ) : ratings.length === 0 ? (
        <EmptyState />
      ) : (
        <Table
          headers={[
            t('drivers.fullName'),
            t('drivers.rating.score'),
            t('drivers.rating.trips'),
            t('drivers.rating.late'),
            t('drivers.rating.fuel'),
            t('drivers.rating.breakdowns'),
          ]}
        >
          {ratings.map((rating) => (
            <RatingRow key={rating.driverId} rating={rating} />
          ))}
        </Table>
      )}
    </Card>
  );
}

function RatingRow({ rating }: { rating: DriverRating }) {
  const { t } = useTranslation();

  return (
    <Row>
      <Cell>{rating.driverName}</Cell>
      <Cell className={`tabular-nums font-semibold ${tone(rating.ratingCentis)}`}>
        {rating.ratingCentis === null
          ? t('drivers.rating.tooFew')
          : `★ ${formatRating(rating.ratingCentis)}`}
      </Cell>
      <Cell className="tabular-nums">{rating.trips}</Cell>
      <Cell className="tabular-nums">
        {rating.lateTrips > 0
          ? `${rating.lateTrips} (${formatBp(rating.lateShareBp)})`
          : t('drivers.rating.none')}
      </Cell>
      <Cell className="tabular-nums">
        {rating.fuelDeviationBp === null ? '—' : formatBp(rating.fuelDeviationBp)}
      </Cell>
      <Cell className="tabular-nums">
        {rating.breakdowns > 0 ? rating.breakdowns : t('drivers.rating.none')}
      </Cell>
    </Row>
  );
}
