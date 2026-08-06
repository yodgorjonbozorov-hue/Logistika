import { useTranslation } from 'react-i18next';
import type { TripStatus } from 'shared';
import { Badge } from '../../shared/ui';

const TONES: Record<TripStatus, 'gray' | 'blue' | 'green' | 'red' | 'orange'> = {
  DRAFT: 'gray',
  ASSIGNED: 'blue',
  IN_PROGRESS: 'orange',
  COMPLETED: 'green',
  CANCELLED: 'red',
};

export function StatusBadge({ status }: { status: TripStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONES[status]}>{t(`status.${status}`)}</Badge>;
}
