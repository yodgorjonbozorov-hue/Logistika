import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Creates the platform's first SUPERADMIN — the only account that cannot be
 * created through the API (every other user is created by a tenant OWNER, and
 * an OWNER is created together with a company by a SUPERADMIN).
 *
 * Runs on every container start and does nothing when the account already
 * exists, so it is safe to keep in the entrypoint. Skipped entirely when
 * SUPERADMIN_EMAIL is unset.
 */
const MIN_PASSWORD_LENGTH = 12;

async function main(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL?.trim();
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email) {
    console.log('[bootstrap] SUPERADMIN_EMAIL is not set — skipping.');
    return;
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `[bootstrap] SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findFirst({ where: { role: 'SUPERADMIN' } });
    if (existing) {
      console.log('[bootstrap] SUPERADMIN already exists — nothing to do.');
      return;
    }

    const user = await prisma.user.create({
      data: {
        fullName: process.env.SUPERADMIN_NAME?.trim() || 'Platform admin',
        email,
        passwordHash: await argon2.hash(password),
        role: 'SUPERADMIN',
        // Platform staff belong to no tenant (schema comment on users.company_id).
        companyId: null,
      },
    });
    console.log(`[bootstrap] SUPERADMIN created: ${user.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
