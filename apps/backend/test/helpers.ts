/**
 * E2E fixtures: a whole tenant in one call, so isolation tests read as
 * "tenant A creates X, tenant B may not see it".
 */
import type { INestApplication } from '@nestjs/common';
import type { Company, Driver, User, Vehicle, Client, Trip } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

export interface TenantFixture {
  company: Company;
  owner: User;
  logist: User;
  driverUser: User;
  driver: Driver;
  vehicle: Vehicle;
  client: Client;
  trip: Trip;
  tokens: { owner: string; logist: string; driver: string };
}

const PASSWORD = 'E2ePassw0rd!';

export async function createTenant(app: INestApplication, label: string): Promise<TenantFixture> {
  const prisma = app.get(PrismaService);
  const auth = app.get(AuthService);
  const passwordHash = await argon2.hash(PASSWORD);
  const suffix = randomUUID().slice(0, 8);

  const company = await prisma.company.create({
    data: { name: `${label} ${suffix}`, isActive: true },
  });

  const makeUser = (role: 'OWNER' | 'LOGIST' | 'DRIVER', name: string) =>
    prisma.user.create({
      data: {
        companyId: company.id,
        fullName: `${label} ${name}`,
        email: `${role.toLowerCase()}.${suffix}@example.test`,
        role,
        passwordHash,
      },
    });

  const owner = await makeUser('OWNER', 'Owner');
  const logist = await makeUser('LOGIST', 'Logist');
  const driverUser = await makeUser('DRIVER', 'Driver');

  const driver = await prisma.driver.create({
    data: {
      companyId: company.id,
      userId: driverUser.id,
      fullName: `${label} Driver`,
      phone: `+9989${suffix.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`,
    },
  });

  const vehicle = await prisma.vehicle.create({
    data: { companyId: company.id, plateNumber: `01${suffix.toUpperCase().slice(0, 5)}` },
  });

  const client = await prisma.client.create({
    data: { companyId: company.id, name: `${label} Client` },
  });

  const trip = await prisma.trip.create({
    data: {
      companyId: company.id,
      tripNumber: `TR-TEST-${suffix}`,
      clientId: client.id,
      vehicleId: vehicle.id,
      driverId: driver.id,
      status: 'ASSIGNED',
      agreedPrice: 100_000_000n,
    },
  });

  const [ownerTokens, logistTokens, driverTokens] = await Promise.all([
    auth.issueTokens(owner),
    auth.issueTokens(logist),
    auth.issueTokens(driverUser),
  ]);

  return {
    company,
    owner,
    logist,
    driverUser,
    driver,
    vehicle,
    client,
    trip,
    tokens: {
      owner: ownerTokens.accessToken,
      logist: logistTokens.accessToken,
      driver: driverTokens.accessToken,
    },
  };
}

export const bearer = (token: string): [string, string] => ['authorization', `Bearer ${token}`];
