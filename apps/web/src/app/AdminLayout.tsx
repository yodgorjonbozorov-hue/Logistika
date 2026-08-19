import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { Icon, PageSkeleton, Tag } from '../shared/ui';
import { AccountMenu } from './AccountMenu';

/**
 * The platform shell.
 *
 * Deliberately not the tenant one: platform staff belong to no company, so a
 * sidebar of company screens would only offer them requests the API refuses.
 * One header, one workspace, and the same Nocturne surface — on a phone it is
 * the same layout with tighter gutters, so no separate mobile shell is needed.
 */
export function AdminLayout() {
  const { t } = useTranslation();

  return (
    <div className="tc-app-height flex flex-col bg-bg font-body text-sm text-ink">
      <header
        className="sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-divider bg-bg px-4 md:px-6"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex h-[54px] w-full items-center gap-3">
          <div
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border border-accent text-accent"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}
          >
            <Icon name="truck" size={17} />
          </div>
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            Truck<span className="text-accent">Control</span>
          </span>
          <Tag variant="outline" className="shrink-0 text-[10.5px] uppercase tracking-[0.08em]">
            {t('admin.platform')}
          </Tag>
          <div className="flex-1" />
          <AccountMenu drop="down" compact />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-10 pt-4 md:px-6 md:pt-[22px]">
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
