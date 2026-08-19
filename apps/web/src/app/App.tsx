import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { UserRole } from 'shared';
import { LoginPage } from '../features/auth/LoginPage';
import { Spinner } from '../shared/ui';
import { AppLayout } from './AppLayout';
import { ProtectedRoute } from './ProtectedRoute';

/**
 * Route-level code splitting (M-14).
 *
 * Everything used to land in one 497 kB bundle, so a logist on a phone
 * downloaded Leaflet and the whole map stack before they could see a trip list.
 * Each page is now its own chunk, and the map — by far the heaviest — is only
 * fetched by someone who actually opens it.
 *
 * The login page stays eager: it is the first thing an unauthenticated visitor
 * sees, and a spinner-then-form flash there is pure jank.
 */
const MapPage = lazy(() => import('../features/map/MapPage').then((m) => ({ default: m.MapPage })));
const TripsPage = lazy(() =>
  import('../features/trips/TripsPage').then((m) => ({ default: m.TripsPage })),
);
const TripDetailPage = lazy(() =>
  import('../features/trips/TripDetailPage').then((m) => ({ default: m.TripDetailPage })),
);
const VehiclesPage = lazy(() =>
  import('../features/fleet/VehiclesPage').then((m) => ({ default: m.VehiclesPage })),
);
const DriversPage = lazy(() =>
  import('../features/drivers/DriversPage').then((m) => ({ default: m.DriversPage })),
);
const ClientsPage = lazy(() =>
  import('../features/clients/ClientsPage').then((m) => ({ default: m.ClientsPage })),
);
const FinancePage = lazy(() =>
  import('../features/finance/FinancePage').then((m) => ({ default: m.FinancePage })),
);
const DashboardPage = lazy(() =>
  import('../features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const AiAssistantPage = lazy(() =>
  import('../features/ai/AiAssistantPage').then((m) => ({ default: m.AiAssistantPage })),
);
const RoutesPage = lazy(() =>
  import('../features/routes/RoutesPage').then((m) => ({ default: m.RoutesPage })),
);
const PublicTrackPage = lazy(() =>
  import('../features/track/PublicTrackPage').then((m) => ({ default: m.PublicTrackPage })),
);

const OFFICE = [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT];
const FLEET = [UserRole.OWNER, UserRole.LOGIST];

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/track/:token" element={<PublicTrackPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route element={<ProtectedRoute allow={OFFICE} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/routes" element={<RoutesPage />} />
              <Route path="/ai" element={<AiAssistantPage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/trips" element={<TripsPage />} />
              <Route path="/trips/:id" element={<TripDetailPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/finance" element={<FinancePage />} />
            </Route>
            <Route element={<ProtectedRoute allow={FLEET} />}>
              <Route path="/vehicles" element={<VehiclesPage />} />
              <Route path="/drivers" element={<DriversPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
