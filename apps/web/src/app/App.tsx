import { Navigate, Route, Routes } from 'react-router-dom';
import { AiChatPage } from '../features/ai/AiChatPage';
import { AlertsPage } from '../features/alerts/AlertsPage';
import { LoginPage } from '../features/auth/LoginPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { DriversPage } from '../features/drivers/DriversPage';
import { FinancePage } from '../features/finance/FinancePage';
import { VehiclesPage } from '../features/fleet/VehiclesPage';
import { FuelPage } from '../features/fuel/FuelPage';
import { MapPage } from '../features/map/MapPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { PublicTrackPage } from '../features/track/PublicTrackPage';
import { TripDetailPage } from '../features/trips/TripDetailPage';
import { TripsPage } from '../features/trips/TripsPage';
import { AppLayout } from './AppLayout';
import { ProtectedRoute } from './ProtectedRoute';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/track/:token" element={<PublicTrackPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/fuel" element={<FuelPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/ai" element={<AiChatPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
