import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { tokenStore } from '../shared/api/client';
import { useAuth } from '../shared/auth/AuthContext';
import { homePathFor, isPlatformAdmin } from '../shared/auth/roles';
import { PageSkeleton } from '../shared/ui';

/**
 * Guards the signed-in half of the app, and keeps each kind of account on the
 * side of it that can actually load: platform staff have no company, so a
 * tenant screen would only fire requests the API answers with 403.
 */
export function ProtectedRoute({ platform = false }: { platform?: boolean }) {
  const location = useLocation();
  const { user, isLoading } = useAuth();

  if (!tokenStore.refresh) return <Navigate to="/login" replace />;
  // The role is not known until /auth/me answers; rendering either shell before
  // then would flash the wrong one.
  if (isLoading || !user) return <PageSkeleton />;

  const admin = isPlatformAdmin(user);
  if (admin !== platform) {
    return <Navigate to={homePathFor(user)} replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
