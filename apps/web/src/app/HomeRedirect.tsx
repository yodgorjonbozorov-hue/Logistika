import { Navigate } from 'react-router-dom';
import { useAuth } from '../shared/auth/AuthContext';
import { homePathFor } from './routes';

/**
 * Sends `/` to the first page this role can actually open (TASK-5.1).
 *
 * It used to be a fixed redirect to `/trips`, which for a DRIVER means the
 * landing screen of the whole app is a 403.
 */
export function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homePathFor(user?.role)} replace />;
}
