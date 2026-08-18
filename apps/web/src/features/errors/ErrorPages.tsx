import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../../shared/auth/AuthContext';
import { Button } from '../../shared/ui';
import { Icon } from '../../shared/ui/icons';
import { homePathFor } from '../../app/navigation';

function ErrorScreen({ code, title, text }: { code: string; title: string; text: string }) {
  const { t } = useTranslation();
  const { role, isAuthenticated } = useAuth();
  const home = isAuthenticated ? homePathFor(role ?? undefined) : '/';

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
          <Icon name="shield" className="h-7 w-7" />
        </div>
        <div className="mt-4 text-5xl font-extrabold tracking-tight text-ink-2">{code}</div>
        <h1 className="mt-2 text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-ink-2">{text}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to={home}>
            <Button size="lg">
              {isAuthenticated ? t('errors.goDashboard') : t('errors.goHome')}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <ErrorScreen code="403" title={t('errors.forbiddenTitle')} text={t('errors.forbiddenText')} />
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <ErrorScreen code="404" title={t('errors.notFoundTitle')} text={t('errors.notFoundText')} />
  );
}
