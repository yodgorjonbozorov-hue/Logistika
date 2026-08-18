import { Navigate, Route, Routes } from 'react-router-dom';
import { AuditLogPage } from '../features/audit/AuditLogPage';
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { DriversPage } from '../features/drivers/DriversPage';
import { FinancePage } from '../features/finance/FinancePage';
import { VehiclesPage } from '../features/fleet/VehiclesPage';
import { MapPage } from '../features/map/MapPage';
import { PublicTrackPage } from '../features/track/PublicTrackPage';
import { TripDetailPage } from '../features/trips/TripDetailPage';
import { TripsPage } from '../features/trips/TripsPage';
import { AppLayout } from './AppLayout';
import { HomeRedirect } from './HomeRedirect';
import { ProtectedRoute } from './ProtectedRoute';
import { ROUTES } from './routes';

/** The element for each guarded path, kept next to the role table in routes.ts. */
const PAGES: Record<string, JSX.Element> = {
  '/map': <MapPage />,
  '/trips': <TripsPage />,
  '/trips/:id': <TripDetailPage />,
  '/vehicles': <VehiclesPage />,
  '/drivers': <DriversPage />,
  '/clients': <ClientsPage />,
  '/finance': <FinancePage />,
  '/audit-logs': <AuditLogPage />,
  '/change-password': <ChangePasswordPage />,
};

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/track/:token" element={<PublicTrackPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomeRedirect />} />
          {/* Rendered from the same table the sidebar reads, so a page the
              menu offers and a page the router allows can never drift apart. */}
          {ROUTES.map((route) => (
            <Route key={route.path} element={<ProtectedRoute allowedRoles={route.roles} />}>
              <Route path={route.path} element={PAGES[route.path]} />
            </Route>
          ))}
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
