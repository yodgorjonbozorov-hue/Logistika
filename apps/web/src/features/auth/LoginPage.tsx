import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/auth/AuthContext';
import { ErrorMessage, Icon, Input } from '../../shared/ui';

const HIGHLIGHTS = [
  { icon: 'map-pin-line', key: 'gps' },
  { icon: 'currency-circle-dollar', key: 'profit' },
  { icon: 'device-mobile', key: 'driverApp' },
] as const;

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password);
      navigate('/overview', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-bg font-body text-sm text-ink">
      <section
        className="hidden flex-1 flex-col border-r border-divider px-12 py-10 lg:flex"
        style={{
          background:
            'radial-gradient(120% 90% at 15% 10%, color-mix(in srgb, var(--color-accent-900) 55%, var(--color-bg)) 0%, var(--color-bg) 55%), linear-gradient(180deg, var(--color-bg), color-mix(in srgb, var(--color-bg) 80%, black))',
        }}
      >
        <Link to="/" className="flex items-center gap-2.5 text-ink hover:text-ink">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md border border-accent text-accent"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}
          >
            <Icon name="truck" size={18} />
          </span>
          <span className="text-base font-semibold">
            Truck<span className="text-accent">Control</span>
          </span>
        </Link>

        <div className="flex max-w-[460px] flex-1 flex-col justify-center">
          <h1 className="m-0 mb-3.5 text-[34px] font-medium leading-[1.2] tracking-[-0.02em]">
            {t('auth.heroLine1')}
            <br />
            {t('auth.heroLine2')}
          </h1>
          <p className="m-0 mb-7 text-[15px] leading-[1.6] text-neutral-400">
            {t('auth.heroBody')}
          </p>
          <div className="flex flex-col gap-3 text-[13.5px]">
            {HIGHLIGHTS.map((item) => (
              <div key={item.key} className="flex items-center gap-2.5">
                <Icon name={item.icon} size={17} style={{ color: 'var(--color-accent)' }} />
                <span className="text-neutral-300">{t(`auth.highlights.${item.key}`)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-neutral-600">{t('auth.copyright')}</div>
      </section>

      <section className="flex w-full shrink-0 items-center justify-center px-5 py-8 sm:p-10 lg:w-[520px]">
        <form onSubmit={onSubmit} className="w-full max-w-[360px]">
          <h2 className="m-0 mb-1 text-[22px] font-medium">{t('auth.loginTitle')}</h2>
          <p className="m-0 mb-6 text-[13px] text-neutral-500">{t('auth.loginSubtitle')}</p>

          <label className="field mb-3.5 block">
            <span className="mb-[5px] block text-xs text-neutral-400">{t('auth.identifier')}</span>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={t('auth.identifierPlaceholder')}
              autoComplete="username"
              required
            />
          </label>

          <div className="field mb-1.5">
            <label className="mb-[5px] flex justify-between text-xs text-neutral-400">
              <span>{t('auth.password')}</span>
              <Link
                to="/login"
                className="-my-3 inline-flex min-h-[44px] items-center text-xs font-normal"
              >
                {t('auth.forgotPassword')}
              </Link>
            </label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="pr-9"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
                className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-neutral-500 hover:text-neutral-300"
              >
                <Icon name={showPassword ? 'eye-slash' : 'eye'} size={16} />
              </button>
            </div>
          </div>

          <div className="mt-2.5">
            <ErrorMessage error={error} />
          </div>

          <label className="my-2 mb-3 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[13px] text-neutral-400">
            <input
              type="checkbox"
              defaultChecked
              className="h-[18px] w-[18px] md:h-[15px] md:w-[15px]"
              style={{ accentColor: 'var(--color-accent)' }}
            />
            {t('auth.rememberMe')}
          </label>

          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary w-full gap-2 py-2.5 text-sm"
          >
            {busy ? <Icon name="circle-notch" size={16} className="animate-spin" /> : null}
            {busy ? t('auth.loggingIn') : t('auth.submit')}
          </button>

          <p className="m-0 mt-[18px] text-center text-[12.5px] text-neutral-500">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="inline-flex min-h-[40px] items-center px-1">
              {t('auth.registerLink')}
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
