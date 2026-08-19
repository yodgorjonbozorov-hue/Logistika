import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

/** One status pill for the whole app — tinted surface, dense label, no border. */
export type BadgeTone = 'gray' | 'blue' | 'green' | 'red' | 'orange';

const TONES: Record<BadgeTone, string> = {
  gray: 'bg-ink/[0.06] text-ink-secondary dark:bg-white/10',
  blue: 'bg-info-surface text-info',
  green: 'bg-success-surface text-success',
  red: 'bg-danger-surface text-danger',
  orange: 'bg-warning-surface text-warning',
};

export function Badge({
  tone,
  children,
  className,
  dot = false,
}: {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
  /** A live indicator — the brand board's pulsing signal dot. */
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-1 text-caption font-semibold',
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span className="h-1.5 w-1.5 animate-lx-pulse rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {children}
    </span>
  );
}
