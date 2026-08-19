import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/auth/AuthContext';
import { BRAND, Button, ErrorMessage, Field, Input, LogixaLogo } from '../../shared/ui';

/** The route line from the brand board cover — origin, waypoints, destination. */
function RouteGraphic() {
  return (
    <svg
      className="pointer-events-none absolute inset-y-0 right-0 h-full w-[520px] opacity-[0.18]"
      viewBox="0 0 520 600"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M-20 520 L140 520 L260 300 L420 300 L520 160"
        stroke={BRAND.primary}
        strokeWidth="2"
        strokeDasharray="1 10"
        strokeLinecap="round"
      />
      <circle cx="140" cy="520" r="5" fill={BRAND.primary} />
      <circle cx="260" cy="300" r="5" fill={BRAND.primary} />
      <circle cx="420" cy="300" r="5" fill={BRAND.primary} />
    </svg>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-brand-secondary text-white">
      {/* Brand panel — desktop only */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden p-12 lg:flex">
        <RouteGraphic />
        <LogixaLogo tone="light" size="lg" className="relative" />
        <div className="relative max-w-md">
          <p className="text-title1 font-semibold">{t('brand.tagline')}</p>
          <p className="mt-3 text-body text-white/60">{t('brand.description')}</p>
        </div>
        <div className="relative font-mono text-caption uppercase tracking-kicker text-white/40">
          {t('brand.kicker')}
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center p-5 lg:w-[520px] lg:border-l lg:border-line lg:bg-surface lg:p-12">
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="w-full max-w-sm animate-lx-rise space-y-4 rounded-2xl bg-surface p-6 text-ink shadow-lg lg:bg-transparent lg:p-0 lg:shadow-none"
        >
          <div className="mb-6">
            <LogixaLogo size="lg" />
            <p className="mt-2 text-subhead text-ink-secondary">{t('auth.loginTitle')}</p>
          </div>

          <Field label={t('auth.identifier')}>
            <Input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
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

          <Button type="submit" size="lg" block loading={busy}>
            {busy ? t('auth.loggingIn') : t('auth.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
