import { useTranslation } from 'react-i18next';
import type { TripStatus } from 'shared';
import { Badge, type BadgeTone } from '../../shared/ui';

const TONES: Record<TripStatus, BadgeTone> = {
  DRAFT: 'gray',
  ASSIGNED: 'blue',
  IN_PROGRESS: 'orange',
  COMPLETED: 'green',
  CANCELLED: 'red',
};

export function StatusBadge({ status }: { status: TripStatus }) {
  const { t } = useTranslation();
  // A trip on the road gets the live signal dot.
  return (
    <Badge tone={TONES[status]} dot={status === 'IN_PROGRESS'}>
      {t(`status.${status}`)}
    </Badge>
  );
}
