import { Navigate, Outlet } from 'react-router-dom';
import { Spinner } from '../shared/ui';
import { useAuth } from '../shared/auth/AuthContext';

/**
 * The session lives in an httpOnly cookie the page cannot read, so membership
 * is decided by /auth/me rather than by looking for a token. While that is in
 * flight the route renders a spinner: redirecting first would bounce every
 * reload to the login page before the cookie had a chance to answer.
 */
export function ProtectedRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
