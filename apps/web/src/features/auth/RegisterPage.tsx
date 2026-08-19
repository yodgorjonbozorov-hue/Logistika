import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { TRIAL_DAYS } from 'shared';
import { useAuth } from '../../shared/auth/AuthContext';
import { ErrorMessage, Icon, Input } from '../../shared/ui';

const PERKS = [
  { icon: 'lightning', key: 'instant' },
  { icon: 'credit-card', key: 'noCard' },
  { icon: 'crown-simple', key: 'owner' },
] as const;

const MIN_PASSWORD = 8;

/**
 * Self-service sign-up: company + owner in one form. Login is e-mail and
 * password — no SMS code is involved anywhere in this flow.
 */
export function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    companyName: '',
    fullName: '',
    email: '',
    phone: '',
    password: '',
    passwordRepeat: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (form.password.length < MIN_PASSWORD) {
      setError(new Error(t('auth.register.passwordTooShort')));
      return;
    }
    if (form.password !== form.passwordRepeat) {
      setError(new Error(t('auth.register.passwordMismatch')));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await register({
        companyName: form.companyName.trim(),
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        password: form.password,
      });
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
            {PERKS.map((perk) => (
              <div key={perk.key} className="flex items-center gap-2.5">
                <Icon name={perk.icon} size={17} style={{ color: 'var(--color-accent)' }} />
                <span className="text-neutral-300">{t(`auth.register.perks.${perk.key}`)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-neutral-600">{t('auth.copyright')}</div>
      </section>

      <section className="flex w-full shrink-0 items-center justify-center p-10 lg:w-[520px]">
        <form onSubmit={onSubmit} className="w-full max-w-[360px]">
          <h2 className="m-0 mb-1 text-[22px] font-medium">{t('auth.register.title')}</h2>
          <p className="m-0 mb-5 text-[13px] text-neutral-500">{t('auth.register.subtitle')}</p>

          <div className="tag mb-5 inline-flex items-center gap-1.5">
            <Icon name="gift" size={14} />
            {t('auth.register.trialNote', { days: TRIAL_DAYS })}
          </div>

          <label className="field mb-3.5 block">
            <span className="mb-[5px] block text-xs text-neutral-400">
              {t('auth.register.companyName')}
            </span>
            <Input
              value={form.companyName}
              onChange={(e) => set('companyName')(e.target.value)}
              placeholder={t('auth.register.companyNamePlaceholder')}
              autoComplete="organization"
              maxLength={190}
              required
            />
          </label>

          <label className="field mb-3.5 block">
            <span className="mb-[5px] block text-xs text-neutral-400">
              {t('auth.register.fullName')}
            </span>
            <Input
              value={form.fullName}
              onChange={(e) => set('fullName')(e.target.value)}
              placeholder={t('auth.register.fullNamePlaceholder')}
              autoComplete="name"
              maxLength={190}
              required
            />
          </label>

          <label className="field mb-3.5 block">
            <span className="mb-[5px] block text-xs text-neutral-400">
              {t('auth.register.email')}
            </span>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
              placeholder={t('auth.register.emailPlaceholder')}
              autoComplete="email"
              maxLength={190}
              required
            />
          </label>

          <label className="field mb-3.5 block">
            <span className="mb-[5px] block text-xs text-neutral-400">
              {t('auth.register.phone')}
            </span>
            <Input
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone')(e.target.value)}
              placeholder={t('auth.register.phonePlaceholder')}
              autoComplete="tel"
              pattern="\+?[0-9]{9,15}"
            />
          </label>

          <div className="field mb-3.5">
            <label className="mb-[5px] flex justify-between text-xs text-neutral-400">
              <span>{t('auth.register.password')}</span>
              <span className="text-neutral-600">{t('auth.register.passwordHint')}</span>
            </label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => set('password')(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                aria-label={t('auth.register.password')}
                className="pr-9"
                minLength={MIN_PASSWORD}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
                className="absolute right-[11px] top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              >
                <Icon name={showPassword ? 'eye-slash' : 'eye'} size={16} />
              </button>
            </div>
          </div>

          <label className="field mb-1.5 block">
            <span className="mb-[5px] block text-xs text-neutral-400">
              {t('auth.register.passwordRepeat')}
            </span>
            <Input
              type={showPassword ? 'text' : 'password'}
              value={form.passwordRepeat}
              onChange={(e) => set('passwordRepeat')(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              required
            />
          </label>

          <div className="mb-4 mt-2.5">
            <ErrorMessage error={error} />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary w-full gap-2 py-2.5 text-sm"
          >
            {busy ? <Icon name="circle-notch" size={16} className="animate-spin" /> : null}
            {busy ? t('auth.register.submitting') : t('auth.register.submit')}
          </button>

          <p className="m-0 mt-[18px] text-center text-[12.5px] text-neutral-500">
            {t('auth.register.haveAccount')} <Link to="/login">{t('auth.register.signIn')}</Link>
          </p>
        </form>
      </section>
    </div>
  );
}
