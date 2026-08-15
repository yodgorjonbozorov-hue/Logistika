/**
 * Entry point of the demo build (`pnpm build:demo`).
 *
 * It renders the real panel with a stubbed network layer, so the whole product
 * can be shown from a single static file — no API, no database, no login.
 * The production entry (`src/main.tsx`) never imports anything from here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../app/App';
import { AuthProvider } from '../shared/auth/AuthContext';
import '../shared/i18n';
import '../index.css';
import { reportCsv, resolve } from './api';

const JSON_HEADERS = { 'content-type': 'application/json' };

function envelope(body: unknown, meta: unknown = null): Response {
  return new Response(JSON.stringify({ success: true, data: body, error: null, meta }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}

function notFound(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'Demo rejimida bu ma’lumot yo‘q' },
      meta: null,
    }),
    { status: 404, headers: JSON_HEADERS },
  );
}

/** Everything the app requests goes here instead of the network. */
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.origin);
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = url.pathname.replace(/^.*\/api\/v1/, '');

  // Report export: hand back a real file so the download button works offline.
  const exportMatch = /^\/reports\/([a-z]+)\/export$/.exec(path);
  if (exportMatch) {
    return new Response(reportCsv(exportMatch[1] as string), {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8' },
    });
  }

  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const result = resolve(method, path, url.searchParams, body);
  // A tiny delay keeps the loading states visible, the way a real call looks.
  await new Promise((done) => setTimeout(done, 120));
  return result ? envelope(result.data, result.meta ?? null) : notFound();
};

// ProtectedRoute only checks that a session exists.
localStorage.setItem('tc.access', 'demo');
localStorage.setItem('tc.refresh', 'demo');

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* In-memory routing: the demo may be opened from any path, including a
          static host that cannot rewrite unknown URLs to index.html. */}
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
);
