import { Navigate, Outlet } from 'react-router-dom';
import type { UserRole } from 'shared';
import { useAuth } from '../shared/auth/AuthContext';
import { Spinner } from '../shared/ui';

/**
 * Route gate.
 *
 * Two jobs, and neither is security — the backend decides that:
 *  - send an unauthenticated visitor to /login instead of flashing an empty
 *    page that immediately errors, and
 *  - keep a role away from a page whose every request would 403 (M-15).
 *
 * `isLoading` matters now that the session is restored asynchronously: without
 * it, a reload would bounce a perfectly valid session to /login before the
 * silent refresh had a chance to finish (H-16).
 */
export function ProtectedRoute({ allow }: { allow?: readonly UserRole[] }) {
  const { user, isLoading, hasSession } = useAuth();

  if (isLoading) return <Spinner />;
  if (!hasSession && !user) return <Navigate to="/login" replace />;
  if (allow && user && !allow.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
