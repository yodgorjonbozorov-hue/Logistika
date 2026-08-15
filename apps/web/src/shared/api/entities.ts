// Response shapes from the backend. Money fields arrive as decimal strings of
// tiyin (BigInt is JSON-serialized to string), dates as ISO strings (UTC).
import type {
  Currency,
  ExpenseCategory,
  PaymentStatus,
  SalaryType,
  TripStatus,
  UserRole,
  VehicleType,
} from 'shared';

export interface User {
  id: string;
  companyId: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  lastLogin: string | null;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  type: VehicleType;
  brand: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  fuelType: string | null;
  fuelNormPer100km: string | null;
  tankCapacity: string | null;
  currentOdometer: number | null;
  purchasePrice: string | null;
  plannedTotalKm: number | null;
  insuranceExpiry: string | null;
  techInspectionExpiry: string | null;
  nextServiceOdometer: number | null;
  isActive: boolean;
}

export interface Driver {
  id: string;
  fullName: string;
  phone: string | null;
  birthDate: string | null;
  passport: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  hireDate: string | null;
  salaryType: SalaryType | null;
  salaryValue: string | null;
  rating: string | null;
  isActive: boolean;
}

export interface Client {
  id: string;
  name: string;
  inn: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTermsDays: number | null;
  balance: string;
}

export interface Trip {
  id: string;
  tripNumber: string;
  clientId: string | null;
  vehicleId: string | null;
  trailerId: string | null;
  driverId: string | null;
  cargoName: string | null;
  cargoWeight: string | null;
  cargoVolume: string | null;
  loadingAddress: string | null;
  loadingDate: string | null;
  unloadingAddress: string | null;
  unloadingDate: string | null;
  plannedDistanceKm: string | null;
  actualDistanceKm: string | null;
  agreedPrice: string;
  currency: Currency;
  driverAdvance: string;
  status: TripStatus;
  startOdometer: number | null;
  endOdometer: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  client?: Client | null;
  vehicle?: Vehicle | null;
  trailer?: Vehicle | null;
  driver?: Driver | null;
}

export interface Expense {
  id: string;
  tripId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  category: ExpenseCategory;
  amount: string;
  currency: Currency;
  quantity: string | null;
  unitPrice: string | null;
  description: string | null;
  paymentMethod: string | null;
  expenseDate: string;
  isApproved: boolean;
}

export interface Income {
  id: string;
  tripId: string | null;
  clientId: string | null;
  amount: string;
  currency: Currency;
  paymentDate: string | null;
  paymentMethod: string | null;
  invoiceNumber: string | null;
  status: PaymentStatus;
  createdAt: string;
}
