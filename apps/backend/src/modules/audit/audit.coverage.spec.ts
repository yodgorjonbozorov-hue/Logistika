import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TZ §9: «Barcha o'zgarishlar audit-log ga yoziladi».
 *
 * This checks the rule against the code rather than against one service at a
 * time: a new module that writes to a business table and forgets the audit call
 * fails here. `docs/SECURITY.md` F-5 is the finding this closes.
 */
const MODULES_DIR = join(__dirname, '..');

/**
 * A Prisma write: `db.x.create(`, `this.prisma.x.update(`, or a `forCompany()`
 * chain. Anchored on the client so `createHash(...).update(...)` is not mistaken
 * for one.
 */
const WRITE =
  /(?:\bdb|\bprisma|forCompany\([^)]*\))\s*\.\s*\w+\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;

/**
 * Writes that are not user edits, with the reason each is exempt. Anything not
 * on this list has to audit, and adding to the list should feel deliberate.
 */
const EXEMPT: Record<string, string> = {
  'ai/ai.service.ts': 'writes only its own request log and usage counter',
  'ai/anomaly.service.ts': 'nightly detector writing its own insights',
  'alerts/alerts.service.ts': 'the alert centre itself; alerts are not user edits',
  'audit/audit.service.ts': 'this is the audit log',
  'auth/auth.service.ts': 'audits through log() with its own actions',
  'auth/driver-auth.service.ts': 'SMS codes and attempt counters, not business data',
  'companies/companies.service.ts': 'audits through log() with before/after',
  'drivers/rating.service.ts': 'nightly cache of a computed rating',
  'events/events.service.ts': 'audits through log(); driver events carry their own trail',
  'expenses/expenses.service.ts': 'audits through log() on create/approve',
  'files/files.service.ts': 'object metadata and the retention purge',
  'public-link/public-link.service.ts': 'issues and expires its own tokens',
  'tracking/tracking.service.ts': 'GPS ingest and the nightly archive move',
  'trips/trips.service.ts': 'audits through log() across the lifecycle',
  'users/users.service.ts': 'audits through log() with before/after',
};

/** Chains span lines, so the source is flattened before it is searched. */
function flatten(source: string): string {
  return source.replace(/\s+/g, ' ');
}

function serviceFiles(): string[] {
  const files: string[] = [];
  for (const moduleName of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!moduleName.isDirectory()) continue;
    for (const file of readdirSync(join(MODULES_DIR, moduleName.name))) {
      if (file.endsWith('.service.ts')) files.push(`${moduleName.name}/${file}`);
    }
  }
  return files.sort();
}

describe('audit coverage (TZ §9)', () => {
  const writers = serviceFiles().filter((file) =>
    WRITE.test(flatten(readFileSync(join(MODULES_DIR, file), 'utf8'))),
  );

  it('finds the services that write, so the check cannot pass vacuously', () => {
    expect(writers.length).toBeGreaterThan(10);
  });

  it('records an audit entry from every service that writes', () => {
    const silent = writers.filter((file) => {
      if (file in EXEMPT) return false;
      const source = readFileSync(join(MODULES_DIR, file), 'utf8');
      return !/this\.audit\.(record|log)\(/.test(source);
    });
    expect(silent).toEqual([]);
  });

  it('keeps the exemption list honest — every entry still exists and still writes', () => {
    const stale = Object.keys(EXEMPT).filter((file) => !writers.includes(file));
    expect(stale).toEqual([]);
  });
});
