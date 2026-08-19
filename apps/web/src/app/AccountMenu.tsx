import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from 'shared';
import { useAuth } from '../shared/auth/AuthContext';
import { setLocale } from '../shared/i18n';
import { Avatar, Icon, initialsOf } from '../shared/ui';
import { cn } from '../shared/utils/cn';

const LOCALE_LABELS: Record<Locale, string> = {
  'uz-latn': "O'zbek (lotin)",
  'uz-cyrl': 'Ўзбек (кирил)',
  ru: 'Русский',
};

/**
 * Who is signed in, which language they read, and the way out. Sits in the
 * sidebar footer of the tenant shell (`drop="up"`) and in the header of the
 * platform shell (`drop="down"`).
 */
export function AccountMenu({
  drop = 'up',
  compact = false,
}: {
  drop?: 'up' | 'down';
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {open ? (
        <div
          className={cn(
            'card absolute z-30 w-[220px] p-1.5 shadow-md',
            drop === 'up' ? 'bottom-full left-0 mb-1.5 w-full' : 'right-0 top-full mt-1.5',
          )}
        >
          <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-neutral-600">
            {t('common.language')}
          </div>
          {LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              onClick={() => setLocale(locale)}
              className={cn(
                'flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] md:min-h-0 md:py-1.5',
                i18n.language === locale
                  ? 'text-accent-200'
                  : 'text-neutral-400 hover:bg-neutral-800/50',
              )}
            >
              <Icon
                name={i18n.language === locale ? 'check' : 'translate'}
                size={14}
                style={{ opacity: i18n.language === locale ? 1 : 0.5 }}
              />
              {LOCALE_LABELS[locale]}
            </button>
          ))}
          <div className="my-1 h-px bg-divider" />
          <button
            type="button"
            onClick={() => void logout()}
            className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-danger-text hover:bg-neutral-800/50 md:min-h-0 md:py-1.5"
          >
            <Icon name="sign-out" size={14} />
            {t('auth.logout')}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={user?.fullName ?? t('common.actions')}
        className={cn(
          'flex items-center gap-2.5 rounded-md text-left hover:bg-neutral-800/50',
          compact ? 'min-h-[44px] p-1.5' : 'w-full p-2',
        )}
      >
        <Avatar initials={initialsOf(user?.fullName)} size={30} tone="accent" />
        {compact ? null : (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-[1.2]">
              {user?.fullName ?? '—'}
            </span>
            <span className="block text-[11px] text-neutral-500">
              {user ? t(`roles.${user.role}`) : ''}
            </span>
          </span>
        )}
        <Icon name="caret-up-down" size={14} style={{ color: 'var(--color-neutral-600)' }} />
      </button>
    </div>
  );
}
