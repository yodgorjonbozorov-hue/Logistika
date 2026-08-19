/**
 * Logging in must actually let the user in.
 *
 * This is the case nothing covered: the backend e2e suite proves `/auth/login`
 * returns tokens, and the Playwright suite runs without a backend, so a
 * successful login that the UI then throws away was invisible to every test in
 * the repo. It was not hypothetical — `login()` wrote the access token to a
 * plain module variable, nothing re-rendered, the `/auth/me` query stayed
 * disabled, and `ProtectedRoute` sent the freshly authenticated user straight
 * back to /login.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';

const apiMock = vi.fn();
vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: (path: string, options?: unknown) => apiMock(path, options),
    restoreSession: vi.fn(async () => false),
  };
});

const { tokenStore } = await import('../api/client');
const { AuthProvider, useAuth } = await import('./AuthContext');
const { LoginPage } = await import('../../features/auth/LoginPage');
const { ProtectedRoute } = await import('../../app/ProtectedRoute');

const OWNER = {
  id: 'user-1',
  companyId: 'company-1',
  fullName: 'Demo Egasi',
  phone: null,
  email: 'demo@example.test',
  role: 'OWNER',
  isActive: true,
  lastLogin: null,
};

function Protected() {
  const { user } = useAuth();
  return <div>protected page for {user?.fullName ?? 'nobody'}</div>;
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Protected />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** Fills the form and submits it, the way a user would. */
async function submitLogin(password: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(/email|telefon/i), {
    target: { value: 'demo@example.test' },
  });
  fireEvent.change(screen.getByLabelText(/parol/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Kirish' }));
}

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    tokenStore.clear();
    apiMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === '/auth/login') {
        return Promise.resolve({
          data: { accessToken: 'access-1', refreshToken: 'r' },
          meta: null,
        });
      }
      if (path === '/auth/me') return Promise.resolve({ data: OWNER, meta: null });
      throw new Error(`unexpected request: ${path}`);
    });
  });

  it('lands the user on the protected page after a successful login', async () => {
    renderApp();
    await submitLogin('correct-horse');

    // Without a reactive token store this never appears: the guard sees no
    // session and replaces the route with /login again.
    expect(await screen.findByText(/protected page for Demo Egasi/)).toBeDefined();
  });

  it('fetches the current user as soon as a token exists', async () => {
    renderApp();
    await submitLogin('correct-horse');

    // The /auth/me query is enabled by the token arriving, not by a re-render
    // that happens to come from somewhere else.
    await waitFor(() =>
      expect(apiMock.mock.calls.some((call) => call[0] === '/auth/me')).toBe(true),
    );
  });

  it('keeps the user on the login page when the credentials are wrong', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === '/auth/login') return Promise.reject(new Error('AUTH_INVALID_CREDENTIALS'));
      throw new Error(`unexpected request: ${path}`);
    });
    renderApp();
    await submitLogin('wrong');

    expect(await screen.findByText('AUTH_INVALID_CREDENTIALS')).toBeDefined();
    expect(screen.queryByText(/protected page/)).toBeNull();
    expect(tokenStore.access).toBeNull();
  });

  it('publishes a session change to every subscriber', () => {
    const listener = vi.fn();
    const unsubscribe = tokenStore.subscribe(listener);

    tokenStore.set('access-2');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(tokenStore.getSnapshot()).toEqual({ hasAccess: true, hasSession: true });

    tokenStore.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(tokenStore.getSnapshot()).toEqual({ hasAccess: false, hasSession: false });

    unsubscribe();
    tokenStore.set('access-3');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('returns a stable snapshot between changes', () => {
    // useSyncExternalStore re-renders forever if getSnapshot returns a new
    // object every call.
    expect(tokenStore.getSnapshot()).toBe(tokenStore.getSnapshot());
  });
});
