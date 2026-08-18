import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DocumentOwnerType } from 'shared';
import { Button, Card, EmptyState, PageHeader, Tag } from '../../shared/ui';
import { cn } from '../../shared/utils/cn';

const FILTERS = ['ALL', ...Object.values(DocumentOwnerType)] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Document archive.
 *
 * The backend stores documents (Prisma `Document`) and the files module signs
 * upload/download URLs, but there is no list endpoint yet — so the screen
 * carries the design's filter row, table shell and upload action, and shows an
 * explicit empty state instead of inventing rows.
 */
export function DocumentsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('ALL');

  return (
    <div>
      <PageHeader
        title={t('documents.title')}
        subtitle={t('documents.subtitle')}
        actions={<Button icon="upload-simple">{t('documents.upload')}</Button>}
      />

      <div className="mb-3.5 flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button key={value} type="button" onClick={() => setFilter(value)}>
            <Tag
              variant={filter === value ? 'accent' : 'outline'}
              className={cn('cursor-pointer text-xs')}
            >
              {value === 'ALL' ? t('common.all') : t(`documents.owners.${value}`)}
            </Tag>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <EmptyState message={t('documents.empty')} />
      </Card>
    </div>
  );
}
