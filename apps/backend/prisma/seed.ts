/**
 * Production seed — the platform bootstrap, nothing else.
 *
 * It creates the single SUPERADMIN account the platform needs to exist before
 * anyone can onboard a tenant. It never creates companies or demo rows; that is
 * `seed-demo.ts`, which must not run against production data.
 *
 *   pnpm --filter backend seed
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEV_DEFAULTS = {
  email: 'admin@truckcontrol.uz',
  password: 'admin12345',
  fullName: 'Platform Superadmin',
};

function requireEnv(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set when seeding a production database`);
  }
  return devFallback;
}

async function main(): Promise<void> {
  const email = requireEnv('SEED_SUPERADMIN_EMAIL', DEV_DEFAULTS.email);
  const password = requireEnv('SEED_SUPERADMIN_PASSWORD', DEV_DEFAULTS.password);
  const fullName = process.env.SEED_SUPERADMIN_NAME ?? DEV_DEFAULTS.fullName;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Superadmin ${email} already exists — nothing to do.`);
    return;
  }

  await prisma.user.create({
    data: {
      companyId: null, // platform staff live outside every tenant
      fullName,
      email,
      passwordHash: await argon2.hash(password),
      role: 'SUPERADMIN',
    },
  });
  console.log(`Superadmin created: ${email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
