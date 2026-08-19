import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { LandingPage } from '../features/landing/LandingPage';
import { tokenStore } from '../shared/api/client';
import { useAuth } from '../shared/auth/AuthContext';
import { homePathFor } from '../shared/auth/roles';
import { PageSkeleton } from '../shared/ui';
import { AdminLayout } from './AdminLayout';
import { AppLayout } from './AppLayout';
import { ProtectedRoute } from './ProtectedRoute';

/**
 * The public entry points (landing, sign-in, sign-up) ship in the first bundle
 * because they are the first paint for a visitor. Everything behind the login
 * is split per route: a phone on a weak link should not download Leaflet and
 * the whole finance screen to look at today's trips.
 */
const OverviewPage = lazy(() =>
  import('../features/overview/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const MapPage = lazy(() => import('../features/map/MapPage').then((m) => ({ default: m.MapPage })));
const TripsPage = lazy(() =>
  import('../features/trips/TripsPage').then((m) => ({ default: m.TripsPage })),
);
const TripCreatePage = lazy(() =>
  import('../features/trips/TripCreatePage').then((m) => ({ default: m.TripCreatePage })),
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
const CargoPage = lazy(() =>
  import('../features/cargo/CargoPage').then((m) => ({ default: m.CargoPage })),
);
const ClientsPage = lazy(() =>
  import('../features/clients/ClientsPage').then((m) => ({ default: m.ClientsPage })),
);
const FinancePage = lazy(() =>
  import('../features/finance/FinancePage').then((m) => ({ default: m.FinancePage })),
);
const DocumentsPage = lazy(() =>
  import('../features/documents/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
);
const ReportsPage = lazy(() =>
  import('../features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const UsersPage = lazy(() =>
  import('../features/users/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const SettingsPage = lazy(() =>
  import('../features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const PublicTrackPage = lazy(() =>
  import('../features/track/PublicTrackPage').then((m) => ({ default: m.PublicTrackPage })),
);
const CompaniesPage = lazy(() =>
  import('../features/admin/CompaniesPage').then((m) => ({ default: m.CompaniesPage })),
);

/**
 * An unknown URL sends a visitor to the marketing page, but a signed-in user to
 * whichever home their role can actually load — dropping them on the landing
 * page reads as having been signed out.
 */
function NotFound() {
  const { user } = useAuth();
  return <Navigate to={tokenStore.refresh ? homePathFor(user) : '/'} replace />;
}

export function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/track/:token" element={<PublicTrackPage />} />
        {/* Platform staff: their own shell, and nothing company-scoped. */}
        <Route element={<ProtectedRoute platform />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<CompaniesPage />} />
          </Route>
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/trips" element={<TripsPage />} />
            <Route path="/trips/new" element={<TripCreatePage />} />
            <Route path="/trips/:id" element={<TripDetailPage />} />
            <Route path="/vehicles" element={<VehiclesPage />} />
            <Route path="/drivers" element={<DriversPage />} />
            <Route path="/cargo" element={<CargoPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/finance" element={<FinancePage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
