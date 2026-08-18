import { Navigate, Outlet } from 'react-router-dom';
import type { UserRole } from 'shared';
import { Spinner } from '../shared/ui';
import { useAuth } from '../shared/auth/AuthContext';
import { ForbiddenPage } from './ForbiddenPage';

/**
 * The session lives in an httpOnly cookie the page cannot read, so membership
 * is decided by /auth/me rather than by looking for a token. While that is in
 * flight the route renders a spinner: redirecting first would bounce every
 * reload to the login page before the cookie had a chance to answer.
 *
 * `allowedRoles` closes M-13 (TASK-5.1). Being signed in used to be the only
 * question asked, so a DRIVER who opened the web app saw every page and
 * collected a 403 from the API on each one — the guard was real, the interface
 * simply lied about what was available. Roles are read from /auth/me, never
 * from storage the page can write to.
 */
export function ProtectedRoute({ allowedRoles }: { allowedRoles?: readonly UserRole[] }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  // Refused, not redirected: a silent bounce to another screen reads as a bug.
  if (allowedRoles && !allowedRoles.includes(user.role)) return <ForbiddenPage />;
  return <Outlet />;
}
