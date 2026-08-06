import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { DriversPage } from '../features/drivers/DriversPage';
import { FinancePage } from '../features/finance/FinancePage';
import { VehiclesPage } from '../features/fleet/VehiclesPage';
import { MapPage } from '../features/map/MapPage';
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
          <Route path="/" element={<Navigate to="/trips" replace />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/finance" element={<FinancePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
