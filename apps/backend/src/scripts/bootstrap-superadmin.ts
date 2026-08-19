/**
 * Creates — or, on an explicit instruction, re-credentials — the platform
 * SUPERADMIN. Without it a fresh production database is unreachable: every
 * other account is created through the API, which itself requires an
 * authenticated admin.
 *
 * Opt-in and deliberately dull:
 *   - does nothing unless SEED_SUPERADMIN_PASSWORD and at least one of
 *     SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_USERNAME are set, so a normal
 *     deploy never touches user data;
 *   - if a SUPERADMIN already exists it is left alone, *unless*
 *     SEED_SUPERADMIN_RESET is `true` — the one way to change the platform
 *     account's sign-in details, and it has to be asked for by name.
 *
 * Run it once, then clear the variables so the next deploy is a no-op again.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const MIN_PASSWORD = 12;

/** Login names are matched lower-cased, so they are stored that way. */
function normaliseUsername(value: string): string {
  return value.trim().toLowerCase();
}

async function main(): Promise<void> {
  const email = process.env.SEED_SUPERADMIN_EMAIL?.trim().toLowerCase() || null;
  const username = process.env.SEED_SUPERADMIN_USERNAME
    ? normaliseUsername(process.env.SEED_SUPERADMIN_USERNAME)
    : null;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  const reset = process.env.SEED_SUPERADMIN_RESET === 'true';

  if (!password || (!email && !username)) {
    console.log('bootstrap-superadmin: SEED_SUPERADMIN_* not set, skipping');
    return;
  }
  if (password.length < MIN_PASSWORD) {
    throw new Error(
      `bootstrap-superadmin: SEED_SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters`,
    );
  }
  if (username && !/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new Error(
      'bootstrap-superadmin: SEED_SUPERADMIN_USERNAME must be 3-64 characters of a-z, 0-9, dot, underscore or hyphen',
    );
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(password);
    const existing = await prisma.user.findFirst({
      where: { role: 'SUPERADMIN' },
      orderBy: { createdAt: 'asc' },
    });

    if (existing && !reset) {
      console.log('bootstrap-superadmin: a SUPERADMIN already exists, leaving it untouched');
      return;
    }

    if (existing) {
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          // Only overwrite an identifier that was actually supplied, so setting
          // a username does not silently drop the e-mail, or the other way round.
          ...(email ? { email } : {}),
          ...(username ? { username } : {}),
          isActive: true,
        },
      });
      console.log(
        `bootstrap-superadmin: reset credentials for SUPERADMIN ${updated.id} ` +
          `(username: ${updated.username ?? '—'}, email: ${updated.email ?? '—'})`,
      );
      return;
    }

    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
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
