import { Navigate, Outlet } from 'react-router-dom';
import { tokenStore } from '../shared/api/client';

export function ProtectedRoute() {
  if (!tokenStore.refresh) return <Navigate to="/login" replace />;
  return <Outlet />;
}
