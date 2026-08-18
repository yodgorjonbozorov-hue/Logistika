import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthContext';
import { homePathFor } from './routes';

/**
 * Shown when a signed-in user opens a page their role cannot use (TASK-5.1).
 *
 * Not a redirect: silently bouncing someone to another screen reads as a bug on
 * their side. Saying what happened, and offering the way back, is the whole
 * job of this page.
 */
export function ForbiddenPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-5xl font-extrabold text-accent-text dark:text-accent">403</p>
      <h1 className="mt-4 text-xl font-bold">{t('errors.forbiddenTitle')}</h1>
      <p className="mt-2 text-sm text-muted-text dark:text-muted">{t('errors.forbiddenBody')}</p>
      <Link
        to={homePathFor(user?.role)}
        className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-navy"
      >
        {t('errors.forbiddenBack')}
      </Link>
    </div>
  );
}
