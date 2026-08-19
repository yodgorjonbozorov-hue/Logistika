import { Navigate, Route, Routes } from 'react-router-dom';
import { UserRole } from 'shared';
import { useAuth } from '../shared/auth/AuthContext';
import { Spinner } from '../shared/ui';
import { LoginPage } from '../features/auth/LoginPage';
import { AlertsPage } from '../features/alerts/AlertsPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { DriversPage } from '../features/drivers/DriversPage';
import { FinancePage } from '../features/finance/FinancePage';
import { FuelPage } from '../features/fuel/FuelPage';
import { VehiclesPage } from '../features/fleet/VehiclesPage';
import { MapPage } from '../features/map/MapPage';
import { PublicTrackPage } from '../features/track/PublicTrackPage';
import { TripDetailPage } from '../features/trips/TripDetailPage';
import { TripsPage } from '../features/trips/TripsPage';
import { AppLayout } from './AppLayout';
import { ProtectedRoute } from './ProtectedRoute';

/** The dashboard is the owner's home; a logist starts where the work is. */
function HomeRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Spinner />;
  const seesFinance = user?.role === UserRole.OWNER || user?.role === UserRole.ACCOUNTANT;
  return <Navigate to={seesFinance ? '/dashboard' : '/trips'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/track/:token" element={<PublicTrackPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/fuel" element={<FuelPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
