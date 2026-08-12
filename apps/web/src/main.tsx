import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './app/App';
import { IS_DEMO } from './shared/api/client';
import { AuthProvider } from './shared/auth/AuthContext';
import './shared/i18n';
import './index.css';

// The demo build ships as one static HTML file — hash routing keeps SPA
// navigation working from any hosting path.
const Router = IS_DEMO ? HashRouter : BrowserRouter;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <App />
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
