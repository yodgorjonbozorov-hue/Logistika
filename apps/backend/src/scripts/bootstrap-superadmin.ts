/**
 * Creates the first SUPERADMIN so a fresh production database is reachable at
 * all — every other account is created through the API, which itself requires
 * an authenticated admin.
 *
 * Idempotent and opt-in:
 *   - does nothing unless BOTH SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD
 *     are set, so a normal deploy never touches user data;
 *   - does nothing if any SUPERADMIN already exists, so re-running it can never
 *     overwrite a live account or reset a password.
 *
 * Run it once against a new database, then clear the two variables.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

async function main(): Promise<void> {
  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;

  if (!email || !password) {
    console.log('bootstrap-superadmin: SEED_SUPERADMIN_* not set, skipping');
    return;
  }
  if (password.length < 12) {
    throw new Error(
      'bootstrap-superadmin: SEED_SUPERADMIN_PASSWORD must be at least 12 characters',
    );
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findFirst({ where: { role: 'SUPERADMIN' } });
    if (existing) {
      console.log('bootstrap-superadmin: a SUPERADMIN already exists, leaving it untouched');
      return;
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password),
        fullName: 'Platform administrator',
        role: 'SUPERADMIN',
        companyId: null,
        isActive: true,
      },
    });
    console.log(`bootstrap-superadmin: created SUPERADMIN ${user.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
