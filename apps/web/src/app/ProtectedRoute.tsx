import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { UserRole } from 'shared';
import { tokenStore } from '../shared/api/client';
import { useAuth } from '../shared/auth/AuthContext';
import { Spinner } from '../shared/ui';

/**
 * Route-level gate. Unauthenticated visitors go to /login (remembering where
 * they wanted to go); a signed-in user without the required role gets /403.
 * Backend guards remain the real authorization — this only shapes the UI.
 */
export function ProtectedRoute({ roles }: { roles?: UserRole[] }) {
  const { user, role, isAuthenticated, isLoading, error } = useAuth();
  const location = useLocation();

  // A dead session (deactivated user, revoked token) must not leave a shell behind.
  useEffect(() => {
    if (error) tokenStore.clear();
  }, [error]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (error) {
    return <Navigate to="/login" replace />;
  }
  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (roles && role && !roles.includes(role)) {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}
