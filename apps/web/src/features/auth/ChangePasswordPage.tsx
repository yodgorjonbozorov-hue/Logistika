import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../../shared/api/client';
import { useAuth } from '../../shared/auth/AuthContext';
import { Button, Card, ErrorMessage, Field, Input } from '../../shared/ui';

/**
 * Changing your own password. The server revokes every session on success, so
 * this screen signs the user out rather than pretending they are still logged
 * in with a token the API has already invalidated.
 */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
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
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword: password },
      });
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h1 className="mb-4 text-lg font-semibold text-navy dark:text-white">
        {t('auth.changePasswordTitle')}
      </h1>
      <form onSubmit={onSubmit} className="max-w-sm space-y-4">
        <p className="text-sm text-muted-text dark:text-muted">{t('auth.changePasswordNote')}</p>
        <Field label={t('auth.currentPassword')}>
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
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
        <Button type="submit" disabled={busy || mismatch}>
          {busy ? t('common.loading') : t('auth.changePasswordSubmit')}
        </Button>
      </form>
    </Card>
  );
}
