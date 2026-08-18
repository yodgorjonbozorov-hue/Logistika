import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api/client';
import { Button, ErrorMessage, Field, Input } from '../../shared/ui';

/** Setting a new password from a reset link (`/reset-password?token=…`). */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = repeat.length > 0 && password !== repeat;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: password },
      });
      // Every session was revoked server-side, so the only way on is a login.
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-2xl dark:bg-white/5 dark:ring-1 dark:ring-white/10"
      >
        <div className="text-center">
          <span className="text-2xl font-extrabold text-navy dark:text-white">
            Truck<span className="text-accent-text dark:text-accent">Control</span> AI
          </span>
          <p className="mt-1 text-sm text-muted-text dark:text-muted">{t('auth.resetTitle')}</p>
        </div>

        {params.get('token') ? null : (
          <Field label={t('auth.resetToken')}>
            <Input value={token} onChange={(e) => setToken(e.target.value)} required />
          </Field>
        )}
        <Field label={t('auth.newPassword')} hint={t('auth.passwordPolicy')}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            required
          />
        </Field>
        <Field label={t('auth.repeatPassword')}>
          <Input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        {mismatch && (
          <p className="text-sm text-danger-text dark:text-danger">{t('auth.passwordMismatch')}</p>
        )}
        <ErrorMessage error={error} />
        <Button type="submit" disabled={busy || mismatch} className="w-full py-2">
          {busy ? t('common.loading') : t('auth.resetSubmit')}
        </Button>

        <Link
          to="/login"
          className="block text-center text-sm text-muted-text dark:text-muted hover:text-accent-text dark:hover:text-accent"
        >
          {t('auth.backToLogin')}
        </Link>
      </form>
    </div>
  );
}
