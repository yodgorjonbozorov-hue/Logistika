import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api/client';
import { Button, ErrorMessage, Field, Input } from '../../shared/ui';

/**
 * Requesting a reset link. The answer is deliberately the same whether or not
 * the account exists — the backend does not say either, and neither does this
 * screen, otherwise it becomes a way to find out who has an account.
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { identifier } });
      setSent(true);
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
            Truck<span className="text-accent">Control</span> AI
          </span>
          <p className="mt-1 text-sm text-muted">{t('auth.forgotTitle')}</p>
        </div>

        {sent ? (
          <p className="rounded-xl bg-success/10 p-3 text-sm text-success" role="status">
            {t('auth.forgotSent')}
          </p>
        ) : (
          <>
            <Field label={t('auth.identifier')}>
              <Input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />
            </Field>
            <ErrorMessage error={error} />
            <Button type="submit" disabled={busy} className="w-full py-2">
              {busy ? t('common.loading') : t('auth.forgotSubmit')}
            </Button>
          </>
        )}

        <Link to="/login" className="block text-center text-sm text-muted hover:text-accent">
          {t('auth.backToLogin')}
        </Link>
      </form>
    </div>
  );
}
