import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { AuthProvider } from './shared/auth/AuthContext';
import './shared/i18n';
import './index.css';
import 'leaflet/dist/leaflet.css';
import '@phosphor-icons/web/regular';
// Loaded last so the Nocturne tokens win over Tailwind preflight and Leaflet.
import './shared/theme/nocturne.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// The offline shell. Registered after first paint so it never competes with
// the app's own bundle for a slow connection, and only in a real build —
// a stale worker in dev would serve yesterday's modules.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
