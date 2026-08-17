import { useTranslation } from 'react-i18next';
import type { TripStatus } from 'shared';
import { Badge } from '../../shared/ui';

const TONES: Record<TripStatus, 'gray' | 'blue' | 'green' | 'red' | 'orange'> = {
  DRAFT: 'gray',
  ASSIGNED: 'blue',
  IN_PROGRESS: 'orange',
  COMPLETED: 'green',
  // Delivered, but not all of it — green would overstate the outcome and red
  // would hide that something did arrive.
  PARTIALLY_DELIVERED: 'orange',
  RETURNED: 'red',
  FAILED: 'red',
  CANCELLED: 'gray',
};

export function StatusBadge({ status }: { status: TripStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONES[status]}>{t(`status.${status}`)}</Badge>;
}
