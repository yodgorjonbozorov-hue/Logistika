/**
 * Demo seed — a realistic "TruckControl Demo" tenant for manual testing.
 *
 * Kept strictly apart from `seed.ts` (the production bootstrap) and refuses to
 * run against a production database. Re-running it wipes and rebuilds ONLY the
 * demo company, so it is safe to repeat during development.
 *
 *   pnpm --filter backend seed:demo
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const COMPANY_NAME = 'TruckControl Demo';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo12345';

/** so'm → tiyin, the only place a demo figure is written in so'm. */
const som = (value: number): bigint => BigInt(value) * 100n;

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date();
const daysAgo = (days: number, hour = 9): Date => {
  const date = new Date(now.getTime() - days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};
const hoursAgo = (hours: number): Date => new Date(now.getTime() - hours * 60 * 60 * 1000);
const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60 * 1000);

async function wipeDemoCompany(companyId: string): Promise<void> {
  // Child rows first — every relation is a hard FK.
  await prisma.gpsTrack.deleteMany({ where: { companyId } });
  await prisma.tripEvent.deleteMany({ where: { companyId } });
  await prisma.trackingLink.deleteMany({ where: { companyId } });
  await prisma.expense.deleteMany({ where: { companyId } });
  await prisma.income.deleteMany({ where: { companyId } });
  await prisma.fuelLog.deleteMany({ where: { companyId } });
  await prisma.maintenance.deleteMany({ where: { companyId } });
  await prisma.document.deleteMany({ where: { companyId } });
  await prisma.notification.deleteMany({ where: { companyId } });
  await prisma.storedFile.deleteMany({ where: { companyId } });
  await prisma.trip.deleteMany({ where: { companyId } });
  await prisma.driver.deleteMany({ where: { companyId } });
  await prisma.vehicle.deleteMany({ where: { companyId } });
  await prisma.client.deleteMany({ where: { companyId } });
  await prisma.auditLog.deleteMany({ where: { companyId } });
  const users = await prisma.user.findMany({ where: { companyId }, select: { id: true } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
}

/** Straight-line interpolation between two points — enough for a demo track. */
function track(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  steps: number,
): Array<{ lat: number; lng: number }> {
  return Array.from({ length: steps }, (_, index) => {
    const ratio = index / (steps - 1);
    return {
      lat: from.lat + (to.lat - from.lat) * ratio,
      lng: from.lng + (to.lng - from.lng) * ratio,
    };
  });
}

const TASHKENT = { lat: 41.2995, lng: 69.2401 };
const SAMARQAND = { lat: 39.627, lng: 66.975 };
const NAVOIY = { lat: 40.0844, lng: 65.3792 };

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-demo must never run against a production database');
  }

  const existing = await prisma.company.findFirst({ where: { name: COMPANY_NAME } });
  if (existing) {
    console.log(`Rebuilding demo company ${existing.id}…`);
    await wipeDemoCompany(existing.id);
  }

  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const year = now.getUTCFullYear();
  const tripNumber = (sequence: number): string =>
    `TR-${year}-${String(sequence).padStart(4, '0')}`;

  const company = await prisma.company.create({
    data: {
      name: COMPANY_NAME,
      inn: '301234567',
      phone: '+998712001020',
      address: "Toshkent sh., Yunusobod t., Amir Temur ko'chasi 108",
      tariffPlan: 'TRIAL',
      subscriptionUntil: new Date(now.getTime() + 60 * DAY_MS),
    },
  });

  const staff = await Promise.all(
    (
      [
        { fullName: 'Rustam Yo‘ldoshev', email: 'owner@demo.uz', role: 'OWNER' },
        { fullName: 'Dilshod Ergashev', email: 'logist@demo.uz', role: 'LOGIST' },
        { fullName: 'Nodira Xolmatova', email: 'buxgalter@demo.uz', role: 'ACCOUNTANT' },
      ] as const
    ).map((user) => prisma.user.create({ data: { companyId: company.id, ...user, passwordHash } })),
  );
  const owner = staff[0]!;

  const driverSeeds = [
    {
      fullName: 'Sardor Aliyev',
      phone: '+998901112233',
      email: 'driver@demo.uz',
      licenseNumber: 'AA1234567',
      salaryType: 'PERCENT' as const,
      salaryValue: 1000n, // basis points → 10 %
    },
    {
      fullName: 'Jasur Karimov',
      phone: '+998901112244',
      email: 'driver2@demo.uz',
      licenseNumber: 'AB7654321',
      salaryType: 'FIXED' as const,
      salaryValue: som(6_000_000),
    },
    {
      fullName: 'Bekzod Toshmatov',
      phone: '+998901112255',
      email: 'driver3@demo.uz',
      licenseNumber: 'AC1122334',
      salaryType: 'PER_KM' as const,
      salaryValue: som(900),
    },
  ];

  const drivers = [];
  for (const seed of driverSeeds) {
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        fullName: seed.fullName,
        phone: seed.phone,
        email: seed.email,
        passwordHash,
        role: 'DRIVER',
      },
    });
    drivers.push(
      await prisma.driver.create({
        data: {
          companyId: company.id,
          userId: user.id,
          fullName: seed.fullName,
          phone: seed.phone,
          licenseNumber: seed.licenseNumber,
          licenseExpiry: new Date(Date.UTC(year + 2, 5, 30)),
          hireDate: daysAgo(400),
          salaryType: seed.salaryType,
          salaryValue: seed.salaryValue,
        },
      }),
    );
  }

  const vehicleSeeds: Prisma.VehicleUncheckedCreateInput[] = [
    {
      companyId: company.id,
      plateNumber: '01 A 123 BC',
      type: 'TRUCK',
      brand: 'MAN',
      model: 'TGX 18.440',
      year: 2019,
      fuelType: 'DIESEL',
      fuelNormPer100km: '32.50',
      tankCapacity: '600.00',
      currentOdometer: 418_500,
      insuranceExpiry: new Date(Date.UTC(year + 1, 2, 15)),
      techInspectionExpiry: new Date(Date.UTC(year, 11, 1)),
    },
    {
      companyId: company.id,
      plateNumber: '01 B 456 DE',
      type: 'TRUCK',
      brand: 'Mercedes-Benz',
      model: 'Actros 1845',
      year: 2021,
      fuelType: 'DIESEL',
      fuelNormPer100km: '30.00',
      tankCapacity: '700.00',
      currentOdometer: 212_300,
      insuranceExpiry: new Date(Date.UTC(year + 1, 6, 20)),
      techInspectionExpiry: new Date(Date.UTC(year + 1, 1, 10)),
    },
    {
      companyId: company.id,
      plateNumber: '01 C 789 FG',
      type: 'TRUCK',
      brand: 'Isuzu',
      model: 'NQR 90',
      year: 2022,
      fuelType: 'DIESEL',
      fuelNormPer100km: '18.00',
      tankCapacity: '200.00',
      currentOdometer: 96_800,
      insuranceExpiry: new Date(Date.UTC(year + 1, 9, 5)),
      techInspectionExpiry: new Date(Date.UTC(year + 1, 4, 25)),
    },
    {
      companyId: company.id,
      plateNumber: '01 T 001 TR',
      type: 'TRAILER',
      brand: 'Schmitz',
      model: 'Cargobull SKO 24',
      year: 2018,
    },
  ];
  const vehicles = [];
  for (const data of vehicleSeeds) {
    vehicles.push(await prisma.vehicle.create({ data }));
  }
  const [truckMan, truckActros, truckIsuzu, trailer] = vehicles as [
    (typeof vehicles)[number],
    (typeof vehicles)[number],
    (typeof vehicles)[number],
    (typeof vehicles)[number],
  ];

  const clientSeeds = [
    { name: 'Agromir Savdo MChJ', inn: '302118844', contactPerson: 'Aziz Rahimov' },
    { name: 'Uzbek Textile Group', inn: '304556677', contactPerson: 'Malika Yusupova' },
    { name: 'Nurli Qurilish', inn: '301998877', contactPerson: 'Shuhrat Nazarov' },
    { name: 'Silk Road Logistics', inn: '306443322', contactPerson: 'Umid Qodirov' },
    { name: 'Farg‘ona Oziq-ovqat', inn: '305772211', contactPerson: 'Zilola Ahmedova' },
  ];
  const clients = [];
  for (const [index, seed] of clientSeeds.entries()) {
    clients.push(
      await prisma.client.create({
        data: {
          companyId: company.id,
          ...seed,
          phone: `+9987120010${20 + index}`,
          email: `info${index + 1}@demo-client.uz`,
          address: 'Toshkent sh.',
          paymentTermsDays: [7, 14, 30, 30, 45][index],
        },
      }),
    );
  }

  // ---------- Trips ----------

  const completedTrip = await prisma.trip.create({
    data: {
      companyId: company.id,
      tripNumber: tripNumber(1),
      clientId: clients[0]!.id,
      vehicleId: truckActros.id,
      trailerId: trailer.id,
      driverId: drivers[1]!.id,
      cargoName: 'Bug‘doy uni, 20 t',
      cargoWeight: '20.00',
      loadingAddress: 'Toshkent, Sergeli logistika markazi',
      loadingLat: TASHKENT.lat,
      loadingLng: TASHKENT.lng,
      loadingDate: daysAgo(12),
      unloadingAddress: 'Samarqand, Ulug‘bek omborxonasi',
      unloadingLat: SAMARQAND.lat,
      unloadingLng: SAMARQAND.lng,
      unloadingDate: daysAgo(11),
      plannedDistanceKm: '310.0',
      actualDistanceKm: '318.0',
      agreedPrice: som(9_500_000),
      driverAdvance: som(1_500_000),
      status: 'COMPLETED',
      startOdometer: 211_800,
      endOdometer: 212_118,
      startedAt: daysAgo(12, 7),
      finishedAt: daysAgo(11, 16),
      createdById: owner.id,
      createdAt: daysAgo(13),
    },
  });

  const inProgressTrip = await prisma.trip.create({
    data: {
      companyId: company.id,
      tripNumber: tripNumber(2),
      clientId: clients[1]!.id,
      vehicleId: truckMan.id,
      trailerId: trailer.id,
      driverId: drivers[0]!.id,
      cargoName: 'To‘qimachilik mahsulotlari, 18 t',
      cargoWeight: '18.00',
      loadingAddress: 'Toshkent, Yangihayot sanoat zonasi',
      loadingLat: TASHKENT.lat,
      loadingLng: TASHKENT.lng,
      loadingDate: daysAgo(1),
      unloadingAddress: 'Navoiy, erkin iqtisodiy zona',
      unloadingLat: NAVOIY.lat,
      unloadingLng: NAVOIY.lng,
      unloadingDate: daysAgo(-1),
      plannedDistanceKm: '480.0',
      agreedPrice: som(14_200_000),
      driverAdvance: som(2_000_000),
      status: 'IN_PROGRESS',
      startOdometer: 418_500,
      startedAt: hoursAgo(9),
      createdById: owner.id,
      createdAt: daysAgo(2),
    },
  });

  const assignedTrip = await prisma.trip.create({
    data: {
      companyId: company.id,
      tripNumber: tripNumber(3),
      clientId: clients[2]!.id,
      vehicleId: truckIsuzu.id,
      driverId: drivers[2]!.id,
      cargoName: 'Qurilish materiallari, 8 t',
      cargoWeight: '8.00',
      loadingAddress: 'Toshkent, Chilonzor bozori ombori',
      loadingLat: TASHKENT.lat,
      loadingLng: TASHKENT.lng,
      loadingDate: new Date(now.getTime() + DAY_MS),
      unloadingAddress: 'Jizzax, sanoat zonasi',
      unloadingLat: 40.1158,
      unloadingLng: 67.842,
      unloadingDate: new Date(now.getTime() + 2 * DAY_MS),
      plannedDistanceKm: '200.0',
      agreedPrice: som(5_400_000),
      driverAdvance: som(700_000),
      status: 'ASSIGNED',
      createdById: owner.id,
      createdAt: hoursAgo(4),
    },
  });

  await prisma.trip.create({
    data: {
      companyId: company.id,
      tripNumber: tripNumber(4),
      clientId: clients[3]!.id,
      cargoName: 'Muzlatilgan mahsulot, 12 t',
      cargoWeight: '12.00',
      loadingAddress: 'Toshkent, Qo‘yliq bozori',
      unloadingAddress: 'Buxoro, markaziy ombor',
      plannedDistanceKm: '580.0',
      agreedPrice: som(16_800_000),
      status: 'DRAFT',
      createdById: owner.id,
      createdAt: hoursAgo(2),
    },
  });

  const paidTrip = await prisma.trip.create({
    data: {
      companyId: company.id,
      tripNumber: tripNumber(5),
      clientId: clients[4]!.id,
      vehicleId: truckIsuzu.id,
      driverId: drivers[2]!.id,
      cargoName: 'Konserva mahsulotlari, 7 t',
      cargoWeight: '7.00',
      loadingAddress: 'Farg‘ona, oziq-ovqat kombinati',
      unloadingAddress: 'Toshkent, Mirzo Ulug‘bek ombori',
      plannedDistanceKm: '340.0',
      actualDistanceKm: '352.0',
      agreedPrice: som(7_900_000),
      driverAdvance: som(1_000_000),
      status: 'COMPLETED',
      startOdometer: 96_400,
      endOdometer: 96_752,
      startedAt: daysAgo(5, 6),
      finishedAt: daysAgo(4, 18),
      createdById: owner.id,
      createdAt: daysAgo(6),
    },
  });

  await prisma.trip.create({
    data: {
      companyId: company.id,
      tripNumber: tripNumber(6),
      clientId: clients[0]!.id,
      cargoName: 'Bekor qilingan yuk',
      loadingAddress: 'Toshkent',
      unloadingAddress: 'Andijon',
      agreedPrice: som(6_100_000),
      status: 'CANCELLED',
      createdById: owner.id,
      createdAt: daysAgo(8),
    },
  });

  // ---------- Driver events ----------

  await prisma.tripEvent.createMany({
    data: [
      {
        companyId: company.id,
        tripId: completedTrip.id,
        driverId: drivers[1]!.id,
        eventType: 'START',
        eventTime: daysAgo(12, 7),
        lat: TASHKENT.lat,
        lng: TASHKENT.lng,
        odometer: 211_800,
      },
      {
        companyId: company.id,
        tripId: completedTrip.id,
        driverId: drivers[1]!.id,
        eventType: 'LOADED',
        eventTime: daysAgo(12, 9),
        lat: TASHKENT.lat,
        lng: TASHKENT.lng,
      },
      {
        companyId: company.id,
        tripId: completedTrip.id,
        driverId: drivers[1]!.id,
        eventType: 'REFUEL',
        eventTime: daysAgo(12, 13),
        lat: 40.5,
        lng: 68.1,
        comment: 'Jizzax AZS, 240 l',
      },
      {
        companyId: company.id,
        tripId: completedTrip.id,
        driverId: drivers[1]!.id,
        eventType: 'DELIVERED',
        eventTime: daysAgo(11, 14),
        lat: SAMARQAND.lat,
        lng: SAMARQAND.lng,
      },
      {
        companyId: company.id,
        tripId: completedTrip.id,
        driverId: drivers[1]!.id,
        eventType: 'FINISH',
        eventTime: daysAgo(11, 16),
        lat: SAMARQAND.lat,
        lng: SAMARQAND.lng,
        odometer: 212_118,
      },
      {
        companyId: company.id,
        tripId: inProgressTrip.id,
        driverId: drivers[0]!.id,
        eventType: 'START',
        eventTime: hoursAgo(9),
        lat: TASHKENT.lat,
        lng: TASHKENT.lng,
        odometer: 418_500,
      },
      {
        companyId: company.id,
        tripId: inProgressTrip.id,
        driverId: drivers[0]!.id,
        eventType: 'LOADED',
        eventTime: hoursAgo(8),
        lat: TASHKENT.lat,
        lng: TASHKENT.lng,
      },
      {
        companyId: company.id,
        tripId: inProgressTrip.id,
        driverId: drivers[0]!.id,
        eventType: 'REFUEL',
        eventTime: hoursAgo(4),
        lat: 40.8,
        lng: 67.9,
        comment: 'Gulliston AZS',
      },
    ],
  });

  // ---------- GPS track for the live map ----------

  const points = track(TASHKENT, NAVOIY, 12);
  await prisma.gpsTrack.createMany({
    data: points.map((point, index) => ({
      companyId: company.id,
      vehicleId: truckMan.id,
      tripId: inProgressTrip.id,
      lat: point.lat,
      lng: point.lng,
      speed: 62 + (index % 5) * 3,
      heading: 250,
      recordedAt: minutesAgo((points.length - index) * 30),
    })),
  });

  // ---------- Money ----------

  await prisma.expense.createMany({
    data: [
      {
        companyId: company.id,
        tripId: completedTrip.id,
        vehicleId: truckActros.id,
        driverId: drivers[1]!.id,
        category: 'FUEL',
        amount: som(3_360_000),
        quantity: '240.00',
        unitPrice: som(14_000),
        description: 'Jizzax AZS, dizel',
        paymentMethod: 'CASH',
        expenseDate: daysAgo(12, 13),
        isApproved: true,
        createdById: owner.id,
      },
      {
        companyId: company.id,
        tripId: completedTrip.id,
        vehicleId: truckActros.id,
        category: 'TOLL',
        amount: som(180_000),
        description: 'Yo‘l boji',
        expenseDate: daysAgo(12, 14),
        isApproved: true,
        createdById: owner.id,
      },
      {
        companyId: company.id,
        tripId: paidTrip.id,
        vehicleId: truckIsuzu.id,
        driverId: drivers[2]!.id,
        category: 'FUEL',
        amount: som(1_540_000),
        quantity: '110.00',
        unitPrice: som(14_000),
        expenseDate: daysAgo(5, 10),
        isApproved: true,
        createdById: owner.id,
      },
      {
        companyId: company.id,
        vehicleId: truckIsuzu.id,
        category: 'REPAIR',
        amount: som(2_100_000),
        description: 'Tormoz kolodkalari almashtirildi',
        expenseDate: daysAgo(3, 11),
        isApproved: false,
        createdById: owner.id,
      },
      {
        companyId: company.id,
        tripId: inProgressTrip.id,
        vehicleId: truckMan.id,
        driverId: drivers[0]!.id,
        category: 'FUEL',
        amount: som(4_200_000),
        quantity: '300.00',
        unitPrice: som(14_000),
        description: 'Gulliston AZS',
        // Today — feeds the dashboard "today's expense" KPI.
        expenseDate: hoursAgo(4),
        isApproved: false,
        createdById: owner.id,
      },
    ],
  });

  await prisma.income.createMany({
    data: [
      {
        companyId: company.id,
        tripId: completedTrip.id,
        clientId: clients[0]!.id,
        amount: som(9_500_000),
        paymentDate: daysAgo(9),
        paymentMethod: 'BANK',
        invoiceNumber: 'INV-1041',
        status: 'PAID',
      },
      {
        companyId: company.id,
        tripId: paidTrip.id,
        clientId: clients[4]!.id,
        amount: som(7_900_000),
        // Today — feeds the dashboard "today's income" KPI.
        paymentDate: hoursAgo(3),
        paymentMethod: 'BANK',
        invoiceNumber: 'INV-1052',
        status: 'PAID',
      },
      {
        companyId: company.id,
        tripId: inProgressTrip.id,
        clientId: clients[1]!.id,
        amount: som(14_200_000),
        paymentDate: new Date(now.getTime() + 10 * DAY_MS),
        invoiceNumber: 'INV-1060',
        status: 'PENDING',
      },
      {
        companyId: company.id,
        tripId: assignedTrip.id,
        clientId: clients[2]!.id,
        amount: som(5_400_000),
        paymentDate: daysAgo(2),
        invoiceNumber: 'INV-1058',
        status: 'OVERDUE',
      },
    ],
  });

  // Client balance mirrors what they still owe (receivables).
  await prisma.client.update({
    where: { id: clients[1]!.id },
    data: { balance: som(14_200_000) },
  });
  await prisma.client.update({
    where: { id: clients[2]!.id },
    data: { balance: som(5_400_000) },
  });

  console.log(`Demo company ready: ${company.name} (${company.id})`);
  console.log(`  owner@demo.uz / logist@demo.uz / buxgalter@demo.uz — parol: ${DEMO_PASSWORD}`);
  console.log(`  driver@demo.uz (+998901112233) — parol: ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
