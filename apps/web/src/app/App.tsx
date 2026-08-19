import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { CargoPage } from '../features/cargo/CargoPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { DocumentsPage } from '../features/documents/DocumentsPage';
import { DriversPage } from '../features/drivers/DriversPage';
import { FinancePage } from '../features/finance/FinancePage';
import { VehiclesPage } from '../features/fleet/VehiclesPage';
import { LandingPage } from '../features/landing/LandingPage';
import { MapPage } from '../features/map/MapPage';
import { OverviewPage } from '../features/overview/OverviewPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { PublicTrackPage } from '../features/track/PublicTrackPage';
import { TripCreatePage } from '../features/trips/TripCreatePage';
import { TripDetailPage } from '../features/trips/TripDetailPage';
import { TripsPage } from '../features/trips/TripsPage';
import { UsersPage } from '../features/users/UsersPage';
import { AppLayout } from './AppLayout';
import { ProtectedRoute } from './ProtectedRoute';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/track/:token" element={<PublicTrackPage />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
