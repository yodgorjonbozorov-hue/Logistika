import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../shared/auth/AuthContext';
import { Button, ErrorMessage, Field, Input } from '../../shared/ui';

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
      // "/" so the index route decides where a session lands; hard-coding a
      // page here means two places to change and one of them gets forgotten.
      navigate('/', { replace: true });
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
          <p className="mt-1 text-sm text-muted">{t('auth.loginTitle')}</p>
        </div>
        <Field label={t('auth.identifier')}>
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>
        <Field label={t('auth.password')}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <ErrorMessage error={error} />
        <Button type="submit" disabled={busy} className="w-full py-2">
          {busy ? t('auth.loggingIn') : t('auth.submit')}
        </Button>
      </form>
    </div>
  );
}
