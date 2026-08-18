import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UserRole } from 'shared';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';

/**
 * What a guarded route actually renders (M-13, TASK-5.1).
 *
 * The role comes from `useAuth`, which reads /auth/me — never from storage the
 * page can write to, because a role a user can edit is not a guard.
 */
const auth = vi.hoisted(() => ({
  value: { user: null as unknown, isLoading: false },
}));
vi.mock('../shared/auth/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderAt(path: string, allowed?: readonly UserRole[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>login screen</p>} />
          <Route element={<ProtectedRoute allowedRoles={allowed} />}>
            <Route path="/trips" element={<p>trips screen</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const OFFICE = [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT] as const;

describe('ProtectedRoute', () => {
  it('waits rather than bouncing while the session is still being fetched', () => {
    auth.value = { user: null, isLoading: true };
    renderAt('/trips', OFFICE);

    // The token lives in memory, so every reload starts with none; redirecting
    // first would send every refresh to the login page.
    expect(screen.queryByText('login screen')).toBeNull();
    expect(screen.queryByText('trips screen')).toBeNull();
  });

  it('sends an anonymous visitor to the login page', () => {
    auth.value = { user: null, isLoading: false };
    renderAt('/trips', OFFICE);

    expect(screen.getByText('login screen')).toBeTruthy();
  });

  it('lets an allowed role through', () => {
    auth.value = { user: { role: UserRole.LOGIST }, isLoading: false };
    renderAt('/trips', OFFICE);

    expect(screen.getByText('trips screen')).toBeTruthy();
  });

  it('shows a driver a 403 page instead of the screen', () => {
    auth.value = { user: { role: UserRole.DRIVER }, isLoading: false };
    renderAt('/trips', OFFICE);

    expect(screen.queryByText('trips screen')).toBeNull();
    expect(screen.getByText('403')).toBeTruthy();
    expect(screen.getByText('errors.forbiddenTitle')).toBeTruthy();
  });

  it('refuses rather than redirecting, so the reason is visible', () => {
    auth.value = { user: { role: UserRole.DRIVER }, isLoading: false };
    renderAt('/trips', OFFICE);

    // A silent bounce to another screen reads as a bug on the user's side.
    expect(screen.queryByText('login screen')).toBeNull();
    expect(screen.getByText('errors.forbiddenBack')).toBeTruthy();
  });

  it('guards nothing when no roles are named', () => {
    auth.value = { user: { role: UserRole.DRIVER }, isLoading: false };
    renderAt('/trips');

    // /change-password is like this on purpose.
    expect(screen.getByText('trips screen')).toBeTruthy();
  });
});
