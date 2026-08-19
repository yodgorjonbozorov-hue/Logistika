/**
 * Platform bootstrap — creates the first SUPERADMIN so a freshly migrated
 * database is actually usable (C-2).
 *
 * Run:  pnpm --filter backend prisma:seed
 *
 * Credentials come from the environment ONLY; nothing is hard-coded here and
 * the password is never logged or written back in plaintext:
 *   SUPERADMIN_EMAIL     — login identifier
 *   SUPERADMIN_PASSWORD  — min 12 chars
 *
 * Idempotent: running it twice never creates a second account. An existing
 * account keeps its password unless SUPERADMIN_RESET_PASSWORD=true is set.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const MIN_PASSWORD_LENGTH = 12;
const WEAK_PASSWORDS = new Set(['password', 'changeme', 'change-me', 'superadmin', 'admin']);

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `${name} is required to seed the platform SUPERADMIN. ` +
        `Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in the deployment environment ` +
        `(never in source control) and re-run the seed.`,
    );
  }
  return value.trim();
}

async function main(): Promise<void> {
  const email = requireEnv('SUPERADMIN_EMAIL').toLowerCase();
  const password = requireEnv('SUPERADMIN_PASSWORD');
  const fullName = process.env.SUPERADMIN_NAME?.trim() || 'Platform Administrator';
  const resetPassword = process.env.SUPERADMIN_RESET_PASSWORD === 'true';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SUPERADMIN_EMAIL is not a valid email address.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    throw new Error('SUPERADMIN_PASSWORD is a well-known default; choose a real secret.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role !== 'SUPERADMIN') {
      throw new Error(
        `A user with email ${email} already exists with role ${existing.role}. ` +
          `Refusing to escalate an existing account — use a dedicated address.`,
      );
    }
    const data: { isActive: boolean; passwordHash?: string } = { isActive: true };
    if (resetPassword) data.passwordHash = await argon2.hash(password);
    await prisma.user.update({ where: { id: existing.id }, data });
    console.log(
      `SUPERADMIN ${email} already exists — left in place` +
        (resetPassword ? ' (password reset as requested)' : '') +
        '.',
    );
    return;
  }

  const created = await prisma.user.create({
    data: {
      companyId: null, // platform staff belong to no tenant
      fullName,
      email,
      passwordHash: await argon2.hash(password),
      role: 'SUPERADMIN',
      isActive: true,
    },
  });
  console.log(`SUPERADMIN created: ${created.email} (id ${created.id}).`);
}

main()
  .catch((error: unknown) => {
    console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
