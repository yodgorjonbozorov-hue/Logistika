import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';
import { LogixaMark } from './Logo';
import { IconAlert, IconInbox } from './icons';

/** Brand-marked loader — the destination node pulses while data lands. */
export function Spinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 py-12 text-subhead text-ink-tertiary"
    >
      <LogixaMark size={32} className="animate-lx-pulse" />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}

/** Placeholder blocks that keep layout stable while a screen loads. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-lx-shimmer rounded-md bg-[length:200%_100%]',
        'bg-gradient-to-r from-ink/[0.05] via-ink/[0.1] to-ink/[0.05]',
        'dark:from-white/[0.04] dark:via-white/[0.1] dark:to-white/[0.04]',
        className,
      )}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-14 text-center">
      <span className="mb-1 text-ink-tertiary">
        <IconInbox size={28} />
      </span>
      <p className="text-headline font-semibold">{title ?? t('common.empty')}</p>
      {description ? <p className="text-subhead text-ink-secondary">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const message = error instanceof Error ? error.message : t('common.errorGeneric');
  return (
    <div
      role="alert"
      className="mb-3 flex items-start gap-2.5 rounded-md bg-danger-surface px-3.5 py-3 text-subhead text-danger"
    >
      <IconAlert size={18} className="mt-px" />
      <span>{message}</span>
    </div>
  );
}
