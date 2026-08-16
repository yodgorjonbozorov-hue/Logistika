/**
 * Demo data for a pilot firm (TZ §12.2).
 *
 * Creates one company with a fleet, drivers, clients and a month of finished
 * trips, so every screen has something real to show on the first login. It is
 * idempotent: everything is keyed by a stable id, so re-running updates rather
 * than duplicates, and the company is deliberately marked as demo data.
 *
 *   pnpm --filter backend seed
 *
 * It refuses to touch a production database unless SEED_FORCE=1 is set — a
 * seed that quietly rewrites a live tenant is worse than no seed at all.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  COMPANY_ID,
  CLIENTS,
  DRIVERS,
  TRIPS,
  USERS,
  VEHICLES,
  day,
  som,
} from '../src/seed/dataset';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'demo1234';

async function seedCompany(): Promise<void> {
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    update: { name: 'Demo Logistika (seed)' },
    create: {
      id: COMPANY_ID,
      name: 'Demo Logistika (seed)',
      inn: '300000001',
      phone: '+998 71 200 40 40',
      address: "Toshkent sh., Amir Temur ko'chasi 108",
      locale: 'uz-latn',
      timezone: 'Asia/Tashkent',
      tariffPlan: 'STANDARD',
    },
  });
}

async function seedUsers(): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  for (const user of USERS) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { fullName: user.fullName, passwordHash },
      create: {
        id: user.id,
        companyId: COMPANY_ID,
        fullName: user.fullName,
        email: user.email,
        passwordHash,
        role: user.role,
      },
    });
  }
}

async function seedFleet(): Promise<void> {
  for (const vehicle of VEHICLES) {
    const data = {
      ...vehicle,
      companyId: COMPANY_ID,
      fuelNormPer100km: new Prisma.Decimal(vehicle.fuelNormPer100km),
      insuranceExpiry: day(200),
      techInspectionExpiry: day(25),
    };
    await prisma.vehicle.upsert({ where: { id: vehicle.id }, update: data, create: data });
  }

  for (const driver of DRIVERS) {
    const data = { ...driver, companyId: COMPANY_ID };
    await prisma.driver.upsert({ where: { id: driver.id }, update: data, create: data });
  }

  for (const client of CLIENTS) {
    const data = { ...client, companyId: COMPANY_ID };
    await prisma.client.upsert({ where: { id: client.id }, update: data, create: data });
  }
}

async function seedTrips(): Promise<void> {
  for (const trip of TRIPS) {
    const [loadingAddress, loadingLat, loadingLng] = trip.loading;
    const [unloadingAddress, unloadingLat, unloadingLng] = trip.unloading;
    const data = {
      companyId: COMPANY_ID,
      tripNumber: trip.tripNumber,
      clientId: trip.clientId,
      vehicleId: trip.vehicleId,
      driverId: trip.driverId,
      cargoName: trip.cargoName,
      loadingAddress,
      loadingLat,
      loadingLng,
      loadingDate: day(trip.startedDaysAgo),
      unloadingAddress,
      unloadingLat,
      unloadingLng,
      unloadingDate: day(trip.finishedDaysAgo ?? trip.startedDaysAgo + 5),
      plannedDistanceKm: new Prisma.Decimal(trip.distanceKm),
      actualDistanceKm: trip.status === 'COMPLETED' ? new Prisma.Decimal(trip.distanceKm) : null,
      agreedPrice: trip.price,
      driverAdvance: trip.advance,
      status: trip.status,
      startedAt: trip.status === 'ASSIGNED' ? null : day(trip.startedDaysAgo),
      finishedAt: trip.finishedDaysAgo === null ? null : day(trip.finishedDaysAgo, 18),
      createdById: 'seed-user-logist',
    };
    await prisma.trip.upsert({
      where: { id: trip.id },
      update: data,
      create: { ...data, id: trip.id },
    });

    if (trip.litres) {
      const fuelId = `${trip.id}-fuel`;
      const litres = new Prisma.Decimal(trip.litres);
      const pricePerLiter = som(12_000);
      const fuel = {
        id: fuelId,
        companyId: COMPANY_ID,
        tripId: trip.id,
        vehicleId: trip.vehicleId,
        driverId: trip.driverId,
        liters: litres,
        pricePerLiter,
        totalAmount: (BigInt(litres.times(100).toFixed(0)) * pricePerLiter) / 100n,
        stationName: 'AZS Uzbekneftegaz',
        refuelTime: day(trip.startedDaysAgo, 11),
      };
      await prisma.fuelLog.upsert({ where: { id: fuelId }, update: fuel, create: fuel });
    }

    // One toll expense per completed trip, plus the client invoice.
    if (trip.status === 'COMPLETED') {
      const expenseId = `${trip.id}-toll`;
      const expense = {
        id: expenseId,
        companyId: COMPANY_ID,
        tripId: trip.id,
        vehicleId: trip.vehicleId,
        driverId: trip.driverId,
        category: 'TOLL' as const,
        amount: som(1_200_000),
        description: "Yo'l boji",
        expenseDate: day(trip.startedDaysAgo, 14),
        isApproved: true,
      };
      await prisma.expense.upsert({ where: { id: expenseId }, update: expense, create: expense });

      const incomeId = `${trip.id}-income`;
      const income = {
        id: incomeId,
        companyId: COMPANY_ID,
        tripId: trip.id,
        clientId: trip.clientId,
        amount: trip.price,
        // The oldest invoice stays unpaid so the receivables screen is not empty.
        status: trip.id === 'seed-trip-1' ? ('OVERDUE' as const) : ('PAID' as const),
        description: `${trip.tripNumber} — yetkazib berish`,
      };
      await prisma.income.upsert({ where: { id: incomeId }, update: income, create: income });
    }
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== '1') {
    throw new Error('Refusing to seed a production database. Set SEED_FORCE=1 to override.');
  }

  await seedCompany();
  await seedUsers();
  await seedFleet();
  await seedTrips();

  console.log(`Seeded "Demo Logistika (seed)".`);
  console.log(`  login: ${USERS[0].email} / ${DEMO_PASSWORD}`);
  console.log(`  ${VEHICLES.length} vehicles, ${DRIVERS.length} drivers, ${TRIPS.length} trips`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
