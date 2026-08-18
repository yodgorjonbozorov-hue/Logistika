import { Navigate, Route, Routes } from 'react-router-dom';
import { UserRole } from 'shared';
import { AdminCompaniesPage } from '../features/admin/AdminCompaniesPage';
import { AdminDashboardPage } from '../features/admin/AdminDashboardPage';
import { LoginPage } from '../features/auth/LoginPage';
import { ClientsPage } from '../features/clients/ClientsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { DriverProfilePage } from '../features/driver/DriverProfilePage';
import { DriverTripPage } from '../features/driver/DriverTripPage';
import { DriverDetailPage } from '../features/drivers/DriverDetailPage';
import { DriversPage } from '../features/drivers/DriversPage';
import { ForbiddenPage, NotFoundPage } from '../features/errors/ErrorPages';
import { FinancePage } from '../features/finance/FinancePage';
import { VehicleDetailPage } from '../features/fleet/VehicleDetailPage';
import { VehiclesPage } from '../features/fleet/VehiclesPage';
import { LandingPage, LegalPage } from '../features/landing/LandingPage';
import { MapPage } from '../features/map/MapPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { PublicTrackPage } from '../features/track/PublicTrackPage';
import { TripCreatePage } from '../features/trips/TripCreatePage';
import { TripDetailPage } from '../features/trips/TripDetailPage';
import { TripsPage } from '../features/trips/TripsPage';
import { AppLayout } from './AppLayout';
import { ProtectedRoute } from './ProtectedRoute';

const STAFF = [UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT];

export function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacy" element={<LegalPage titleKey="landing.footerPrivacy" />} />
      <Route path="/terms" element={<LegalPage titleKey="landing.footerTerms" />} />
      <Route path="/track/:token" element={<PublicTrackPage />} />
      <Route path="/403" element={<ForbiddenPage />} />

      {/* Company staff */}
      <Route element={<ProtectedRoute roles={STAFF} />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/new" element={<TripCreatePage />} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
          <Route path="/tracking" element={<MapPage />} />
          <Route path="/map" element={<Navigate to="/tracking" replace />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/drivers/:id" element={<DriverDetailPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* Platform staff */}
      <Route element={<ProtectedRoute roles={[UserRole.SUPERADMIN]} />}>
        <Route element={<AppLayout />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/companies" element={<AdminCompaniesPage />} />
        </Route>
      </Route>

      {/* Driver (mobile-first web) */}
      <Route element={<ProtectedRoute roles={[UserRole.DRIVER]} />}>
        <Route element={<AppLayout />}>
          <Route path="/driver" element={<DriverTripPage />} />
          <Route path="/driver/profile" element={<DriverProfilePage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
