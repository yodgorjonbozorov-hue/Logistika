import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';
import { IconButton } from './Button';
import { IconClose } from './icons';

/**
 * iOS-flavoured dialog: a card that rises on desktop, a sheet that slides up
 * on a phone. Escape closes, the backdrop closes, focus starts inside.
 */
export function Modal({
  title,
  open,
  onClose,
  children,
  size = 'md',
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: 'md' | 'lg';
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-lx-fade-in items-end justify-center overflow-y-auto bg-brand-secondary/50 backdrop-blur-[2px] sm:items-start sm:p-4 sm:pt-16"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'w-full animate-lx-sheet-up overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 shadow-lg outline-none',
          // A sheet never runs past the screen — it caps and scrolls inside.
          'max-h-[92dvh] safe-bottom sm:max-h-[85vh] sm:animate-lx-rise sm:rounded-2xl',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div
          className="mx-auto mb-3 h-1 w-9 rounded-pill bg-line-strong sm:hidden"
          aria-hidden="true"
        />
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-title3 font-semibold">{title}</h2>
          <IconButton aria-label={t('common.close')} size="sm" onClick={onClose}>
            <IconClose size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Sticky action row for dialog forms — cancel left, commit right. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 pt-2">{children}</div>;
}
