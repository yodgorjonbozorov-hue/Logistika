import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes (M-14).
 *
 * Without one, a single thrown error in any component unmounts the entire React
 * tree and the user is left staring at a blank white page with no way forward.
 * A lazily-loaded route chunk failing to download — a deploy mid-session, a bad
 * connection in a truck yard — is the most likely trigger, and reloading fixes
 * exactly that case.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console rather than sent anywhere: no error-reporting service
    // is configured, and shipping stack traces to a third party is not
    // something to enable silently.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <CrashScreen onRetry={() => this.setState({ error: null })} />;
  }
}

function CrashScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-bold">{t('common.crashTitle')}</h1>
      <p className="max-w-sm text-sm text-muted">{t('common.crashBody')}</p>
      <div className="flex gap-2">
        <button
          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-navy"
          onClick={() => window.location.reload()}
        >
          {t('common.reload')}
        </button>
        <button
          className="min-h-11 rounded-lg border border-gray-300 px-4 text-sm dark:border-white/20"
          onClick={onRetry}
        >
          {t('common.retry')}
        </button>
      </div>
    </div>
  );
}
