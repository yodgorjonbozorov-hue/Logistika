import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../app/App';
import { AuthProvider } from '../shared/auth/AuthContext';
import { initTheme } from '../shared/theme';
import '../shared/i18n';
import '../index.css';
import './demo.css';
import { DemoChrome } from './DemoChrome';
import { DEMO_EMPTY, DEMO_ROUTES } from './fixtures';

/**
 * Offline preview build: the real application, served from fixtures instead of
 * the API. Nothing here ships in the production bundle — `vite.demo.config.ts`
 * is the only entry that pulls it in.
 */

// A session the app believes in, so the protected routes render.
localStorage.setItem('tc.access', 'demo-access-token');
localStorage.setItem('tc.refresh', 'demo-refresh-token');

const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('/api/v1')) return realFetch(input as RequestInfo, init);

  const path = new URL(url, window.location.origin).pathname.replace(/^.*\/api\/v1/, '');
  const body = DEMO_ROUTES[path] ?? DEMO_EMPTY;
  // A short delay so loading states are visible rather than skipped.
  await new Promise((resolve) => setTimeout(resolve, 180));
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

initTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/trips']}>
        <AuthProvider>
          <App />
          <DemoChrome />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
);
