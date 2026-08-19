import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DocumentOwnerType } from 'shared';
import { Button, Card, EmptyBlock, PageHeader } from '../../shared/ui';
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

      {/* A scrolling chip row keeps five filters on one line at 320px without
          shrinking any of them below a thumb's width. */}
      <div className="-mx-4 mb-3.5 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'tag shrink-0 min-h-[40px] cursor-pointer whitespace-nowrap px-3.5 text-xs md:min-h-0 md:px-2.5',
              filter === value ? 'tag-accent' : 'tag-outline',
            )}
          >
            {value === 'ALL' ? t('common.all') : t(`documents.owners.${value}`)}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <EmptyBlock
          icon="files"
          title={t('documents.emptyTitle')}
          description={t('documents.empty')}
        />
      </Card>
    </div>
  );
}
