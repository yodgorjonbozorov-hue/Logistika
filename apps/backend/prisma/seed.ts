/**
 * Database seed (TASK-1.1).
 *
 * Always: one SUPERADMIN — the only way to bootstrap a fresh install, because
 * creating a company requires SUPERADMIN (companies.controller.ts). The password
 * comes from SEED_SUPERADMIN_PASSWORD; there is deliberately no default.
 *
 * Non-production only: a demo tenant with users, fleet, clients and trips so the
 * web/mobile apps have something to show.
 *
 * Idempotent: every write is an upsert keyed by a stable natural key, so running
 * the seed twice does not create duplicates.
 */
import { PrismaClient, SalaryType, TripStatus, UserRole, VehicleType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_COMPANY_NAME = 'Demo Logistika MChJ';
const DEMO_PASSWORD = 'Demo12345!';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `${name} is required to seed the database. Set it in .env (no default is provided on purpose).`,
    );
  }
  return value;
}

/** Days offset from "now", so seeded data stays fresh on every run. */
function daysFromNow(days: number, hour = 9): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function seedSuperadmin(): Promise<void> {
  const email = process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@truckcontrol.uz';
  const password = requireEnv('SEED_SUPERADMIN_PASSWORD');
  const passwordHash = await argon2.hash(password);

  await prisma.user.upsert({
    where: { email },
    // Password is not rewritten on re-run: an operator may have rotated it already.
    update: { role: UserRole.SUPERADMIN, isActive: true, companyId: null },
    create: {
      email,
      fullName: 'Platform Superadmin',
      passwordHash,
      role: UserRole.SUPERADMIN,
      companyId: null,
    },
  });

  console.log(`✓ SUPERADMIN ready: ${email}`);
}

async function seedDemoTenant(): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  const existing = await prisma.company.findFirst({ where: { name: DEMO_COMPANY_NAME } });
  const company = existing
    ? await prisma.company.update({
        where: { id: existing.id },
        data: { isActive: true, subscriptionUntil: daysFromNow(365) },
      })
    : await prisma.company.create({
        data: {
          name: DEMO_COMPANY_NAME,
          inn: '301234567',
          address: "Toshkent sh., Chilonzor t., Bunyodkor ko'chasi 12",
          phone: '+998712001020',
          tariffPlan: 'demo',
          subscriptionUntil: daysFromNow(365),
        },
      });

  const staff = [
    {
      email: 'owner@demo.uz',
      fullName: 'Alisher Karimov',
      role: UserRole.OWNER,
      phone: '+998901112233',
    },
    {
      email: 'logist@demo.uz',
      fullName: 'Dilnoza Rahimova',
      role: UserRole.LOGIST,
      phone: '+998901112234',
    },
    {
      email: 'buxgalter@demo.uz',
      fullName: 'Sardor Tursunov',
      role: UserRole.ACCOUNTANT,
      phone: '+998901112235',
    },
  ];

  for (const person of staff) {
    await prisma.user.upsert({
      where: { email: person.email },
      update: { companyId: company.id, role: person.role, isActive: true },
      create: { ...person, companyId: company.id, passwordHash },
    });
  }

  // Drivers: one has a login account (mobile app), one does not — both shapes occur in practice.
  const driverUser = await prisma.user.upsert({
    where: { phone: '+998901112236' },
    update: { companyId: company.id, role: UserRole.DRIVER, isActive: true },
    create: {
      phone: '+998901112236',
      fullName: 'Bekzod Ismoilov',
      role: UserRole.DRIVER,
      companyId: company.id,
      passwordHash,
    },
  });

  const driverOne = await upsertDriver(company.id, {
    fullName: 'Bekzod Ismoilov',
    phone: '+998901112236',
    userId: driverUser.id,
    licenseNumber: 'AA1234567',
    salaryType: SalaryType.PER_KM,
    salaryValue: 50_000n, // 500 so'm/km in tiyin
  });

  const driverTwo = await upsertDriver(company.id, {
    fullName: 'Jasur Qodirov',
    phone: '+998901112237',
    licenseNumber: 'AB7654321',
    salaryType: SalaryType.FIXED,
    salaryValue: 600_000_000n, // 6 000 000 so'm/month in tiyin
  });

  const truck = await upsertVehicle(company.id, {
    plateNumber: '01A123BC',
    type: VehicleType.TRUCK,
    brand: 'MAN',
    model: 'TGX 18.440',
    year: 2019,
    fuelType: 'diesel',
    fuelNormPer100km: '32.50',
    tankCapacity: '700.00',
    currentOdometer: 412_300,
  });

  const van = await upsertVehicle(company.id, {
    plateNumber: '01B456DE',
    type: VehicleType.TRUCK,
    brand: 'Isuzu',
    model: 'NPR 75',
    year: 2021,
    fuelType: 'diesel',
    fuelNormPer100km: '18.00',
    tankCapacity: '140.00',
    currentOdometer: 96_450,
  });

  const trailer = await upsertVehicle(company.id, {
    plateNumber: '01C789FG',
    type: VehicleType.TRAILER,
    brand: 'Schmitz',
    model: 'SKO 24',
    year: 2018,
  });

  const clientOne = await upsertClient(company.id, {
    name: 'Oq Bugdoy Savdo MChJ',
    inn: '302233445',
    contactPerson: 'Anvar Yo‘ldoshev',
    phone: '+998712334455',
    address: 'Toshkent sh., Yunusobod t.',
    paymentTermsDays: 14,
  });

  const clientTwo = await upsertClient(company.id, {
    name: 'Andijon Agro Eksport',
    inn: '303344556',
    contactPerson: 'Nodira Ergasheva',
    phone: '+998742556677',
    address: 'Andijon sh., Sanoat ko‘chasi 4',
    paymentTermsDays: 30,
  });

  const year = new Date().getUTCFullYear();

  const completedTrip = await upsertTrip(company.id, `TR-${year}-000001`, {
    clientId: clientOne.id,
    vehicleId: truck.id,
    trailerId: trailer.id,
    driverId: driverOne.id,
    cargoName: 'Un (50 kg qoplarda)',
    cargoWeight: '18000.00',
    loadingAddress: 'Toshkent sh., Sergeli omborxonasi',
    loadingLat: 41.2035,
    loadingLng: 69.2201,
    loadingDate: daysFromNow(-6),
    unloadingAddress: 'Samarqand sh., Markaziy bozor ombori',
    unloadingLat: 39.6542,
    unloadingLng: 66.9597,
    unloadingDate: daysFromNow(-5),
    plannedDistanceKm: '310.0',
    actualDistanceKm: '318.0',
    agreedPrice: 950_000_000n, // 9 500 000 so'm
    driverAdvance: 100_000_000n,
    status: TripStatus.COMPLETED,
    startOdometer: 411_500,
    endOdometer: 411_818,
    startedAt: daysFromNow(-6, 7),
    finishedAt: daysFromNow(-5, 15),
  });

  const activeTrip = await upsertTrip(company.id, `TR-${year}-000002`, {
    clientId: clientTwo.id,
    vehicleId: van.id,
    driverId: driverTwo.id,
    cargoName: 'Quruq meva',
    cargoWeight: '4200.00',
    loadingAddress: 'Andijon sh., Agro ombor',
    loadingLat: 40.7821,
    loadingLng: 72.3442,
    loadingDate: daysFromNow(-1),
    unloadingAddress: 'Toshkent sh., Qo‘yliq bozori',
    unloadingLat: 41.2646,
    unloadingLng: 69.3311,
    unloadingDate: daysFromNow(0, 18),
    plannedDistanceKm: '420.0',
    agreedPrice: 620_000_000n,
    driverAdvance: 50_000_000n,
    status: TripStatus.IN_PROGRESS,
    startOdometer: 96_100,
    startedAt: daysFromNow(-1, 6),
  });

  await upsertTrip(company.id, `TR-${year}-000003`, {
    clientId: clientOne.id,
    vehicleId: truck.id,
    driverId: driverOne.id,
    cargoName: 'Qurilish materiallari',
    cargoWeight: '20000.00',
    loadingAddress: 'Toshkent sh., Yangihayot t.',
    loadingDate: daysFromNow(2),
    unloadingAddress: 'Buxoro sh., Sanoat zonasi',
    unloadingDate: daysFromNow(3),
    plannedDistanceKm: '580.0',
    agreedPrice: 1_400_000_000n,
    status: TripStatus.ASSIGNED,
  });

  // Events, expenses and one income on the completed trip so reports are not empty.
  await upsertEvent(company.id, `seed-${completedTrip.id}-start`, {
    tripId: completedTrip.id,
    driverId: driverOne.id,
    eventType: 'START',
    eventTime: daysFromNow(-6, 7),
    lat: 41.2035,
    lng: 69.2201,
    odometer: 411_500,
  });

  await upsertEvent(company.id, `seed-${completedTrip.id}-refuel`, {
    tripId: completedTrip.id,
    driverId: driverOne.id,
    eventType: 'REFUEL',
    eventTime: daysFromNow(-6, 11),
    lat: 40.5286,
    lng: 68.7797,
    odometer: 411_640,
    comment: 'Jizzax yo‘lidagi shaxobcha',
  });

  await upsertEvent(company.id, `seed-${completedTrip.id}-finish`, {
    tripId: completedTrip.id,
    driverId: driverOne.id,
    eventType: 'FINISH',
    eventTime: daysFromNow(-5, 15),
    lat: 39.6542,
    lng: 66.9597,
    odometer: 411_818,
  });

  await upsertEvent(company.id, `seed-${activeTrip.id}-start`, {
    tripId: activeTrip.id,
    driverId: driverTwo.id,
    eventType: 'START',
    eventTime: daysFromNow(-1, 6),
    lat: 40.7821,
    lng: 72.3442,
    odometer: 96_100,
  });

  await upsertExpense(company.id, 'seed-fuel-trip-1', {
    tripId: completedTrip.id,
    vehicleId: truck.id,
    driverId: driverOne.id,
    category: 'FUEL',
    amount: 121_500_000n, // 1 215 000 so'm
    quantity: '135.00',
    unitPrice: 900_000n,
    expenseDate: daysFromNow(-6, 11),
    isApproved: true,
  });

  await upsertExpense(company.id, 'seed-toll-trip-1', {
    tripId: completedTrip.id,
    vehicleId: truck.id,
    driverId: driverOne.id,
    category: 'TOLL',
    amount: 8_000_000n,
    expenseDate: daysFromNow(-6, 13),
    isApproved: true,
  });

  await upsertExpense(company.id, 'seed-fuel-trip-2', {
    tripId: activeTrip.id,
    vehicleId: van.id,
    driverId: driverTwo.id,
    category: 'FUEL',
    amount: 63_000_000n,
    quantity: '70.00',
    unitPrice: 900_000n,
    expenseDate: daysFromNow(-1, 8),
  });

  await upsertIncome(company.id, `INV-${year}-0001`, {
    tripId: completedTrip.id,
    clientId: clientOne.id,
    amount: 950_000_000n,
    paymentDate: daysFromNow(-4),
    paymentMethod: 'bank',
    status: 'PAID',
  });

  console.log(`✓ Demo tenant ready: ${company.name} (owner@demo.uz / ${DEMO_PASSWORD})`);
}

// ---------- upsert helpers (natural keys, so re-runs are no-ops) ----------

type DriverSeed = {
  fullName: string;
  phone: string;
  userId?: string;
  licenseNumber: string;
  salaryType: SalaryType;
  salaryValue: bigint;
};

async function upsertDriver(companyId: string, data: DriverSeed) {
  const existing = await prisma.driver.findFirst({ where: { companyId, fullName: data.fullName } });
  if (existing) {
    return prisma.driver.update({ where: { id: existing.id }, data: { ...data, isActive: true } });
  }
  return prisma.driver.create({ data: { ...data, companyId, hireDate: daysFromNow(-400) } });
}

async function upsertVehicle(
  companyId: string,
  data: { plateNumber: string } & Record<string, unknown>,
) {
  const { plateNumber, ...rest } = data;
  return prisma.vehicle.upsert({
    where: { companyId_plateNumber: { companyId, plateNumber } },
    update: { ...rest, isActive: true },
    create: { companyId, plateNumber, ...rest },
  }) as ReturnType<typeof prisma.vehicle.upsert>;
}

async function upsertClient(companyId: string, data: { name: string } & Record<string, unknown>) {
  const existing = await prisma.client.findFirst({ where: { companyId, name: data.name } });
  if (existing) {
    return prisma.client.update({ where: { id: existing.id }, data });
  }
  return prisma.client.create({ data: { ...data, companyId } as never });
}

async function upsertTrip(companyId: string, tripNumber: string, data: Record<string, unknown>) {
  return prisma.trip.upsert({
    where: { companyId_tripNumber: { companyId, tripNumber } },
    update: data as never,
    create: { companyId, tripNumber, ...data } as never,
  });
}

async function upsertEvent(
  companyId: string,
  clientEventId: string,
  data: Record<string, unknown>,
) {
  return prisma.tripEvent.upsert({
    // The key is unique per company now, so the seed has to say which company
    // it means — a bare id is no longer a unique row.
    where: { companyId_clientEventId: { companyId, clientEventId } },
    update: data as never,
    create: { companyId, clientEventId, ...data } as never,
  });
}

/**
 * Expenses have no natural key in the schema, so the seed uses the description
 * field as a stable marker — enough to stay idempotent without a schema change.
 */
async function upsertExpense(companyId: string, marker: string, data: Record<string, unknown>) {
  const existing = await prisma.expense.findFirst({ where: { companyId, description: marker } });
  if (existing) {
    return prisma.expense.update({ where: { id: existing.id }, data: data as never });
  }
  return prisma.expense.create({ data: { companyId, description: marker, ...data } as never });
}

async function upsertIncome(
  companyId: string,
  invoiceNumber: string,
  data: Record<string, unknown>,
) {
  const existing = await prisma.income.findFirst({ where: { companyId, invoiceNumber } });
  if (existing) {
    return prisma.income.update({ where: { id: existing.id }, data: data as never });
  }
  return prisma.income.create({ data: { companyId, invoiceNumber, ...data } as never });
}

async function main(): Promise<void> {
  await seedSuperadmin();

  if (process.env.NODE_ENV === 'production') {
    console.log('· NODE_ENV=production — demo data skipped.');
    return;
  }

  await seedDemoTenant();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
