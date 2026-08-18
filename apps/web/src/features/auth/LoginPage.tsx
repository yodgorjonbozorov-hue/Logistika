import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { UserRole } from 'shared';
import { Logo } from '../../app/AppLayout';
import { homePathFor } from '../../app/navigation';
import { useAuth } from '../../shared/auth/AuthContext';
import { Button, ErrorMessage, Field, Input } from '../../shared/ui';
import { Icon } from '../../shared/ui/icons';

export function LoginPage() {
  const { t } = useTranslation();
  const { login, isAuthenticated, role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(false);

  // Already signed in — skip the form and go where this role belongs.
  if (isAuthenticated && role) {
    return <Navigate to={homePathFor(role)} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(identifier.trim(), password);
      const home = homePathFor(user.role as UserRole);
      // Honour the page the guard bounced them from, unless it belongs to another role.
      const from = location.state?.from;
      navigate(from && from !== '/login' ? from : home, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-2">
      {/* Brand side — hidden on phones so the form owns the viewport. */}
      <aside className="relative hidden flex-col justify-between bg-navy p-10 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_50%_at_30%_20%,rgba(245,166,35,0.22),transparent)]"
        />
        <div className="relative">
          <Link to="/" className="inline-flex">
            <Logo />
          </Link>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight">{t('landing.heroTitle')}</h2>
          <p className="mt-4 text-white/70">{t('landing.heroSubtitle')}</p>
        </div>
        <div className="relative text-sm text-white/50">
          © {new Date().getFullYear()} TruckControl AI
        </div>
      </aside>

      <main className="flex items-center justify-center p-5">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <Link to="/">
              <Logo />
            </Link>
          </div>

          <h1 className="text-2xl font-bold tracking-tight">{t('auth.loginTitle')}</h1>
          <p className="mt-1 text-sm text-ink-2">{t('auth.loginSubtitle')}</p>

          <form onSubmit={(event) => void onSubmit(event)} className="mt-6 space-y-4">
            <Field label={t('auth.identifier')}>
              <Input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={t('auth.identifierPlaceholder')}
                autoComplete="username"
                autoFocus
                required
              />
            </Field>
            <Field label={t('auth.password')}>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>

            <ErrorMessage error={error} />

            <Button type="submit" disabled={busy} size="lg" className="w-full">
              {busy ? t('auth.loggingIn') : t('auth.submit')}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setHint((value) => !value)}
              className="text-sm text-ink-2 underline-offset-2 hover:text-ink hover:underline"
            >
              {t('auth.forgot')}
            </button>
            {hint ? (
              <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2">
                {t('auth.forgotHint')}
              </p>
            ) : null}
          </div>

          <Link
            to="/"
            className="mt-8 flex items-center justify-center gap-1 text-sm text-ink-2 hover:text-ink"
          >
            <Icon name="chevronLeft" className="h-4 w-4" />
            {t('auth.backToLanding')}
          </Link>
        </div>
      </main>
    </div>
  );
}
