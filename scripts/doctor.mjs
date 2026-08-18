/**
 * `pnpm doctor` — checks every prerequisite the dev setup needs and prints the
 * exact command that fixes whatever is missing.
 *
 * Deliberately dependency-free and failure-tolerant: it must still produce a
 * useful report on a machine where the install itself went wrong.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'apps/backend/index.js'));

const results = [];
let firstProblem = null;

function report(name, ok, detail, fix) {
  results.push({ name, ok, detail, fix });
  if (!ok && !firstProblem) firstProblem = { name, detail, fix };
}

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return null;
  const env = {};
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at === -1) continue;
    let value = line.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, at).trim()] = value;
  }
  return env;
}

/** Plain TCP reachability — enough to tell "service is down" from "wrong password". */
function tcpCheck(host, port, timeout = 2500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function main() {
  console.log('\nTruckControl AI — muhit tekshiruvi\n' + '='.repeat(38));

  // ---------- 1. Runtime ----------
  const major = Number(process.versions.node.split('.')[0]);
  report(
    'Node.js',
    major >= 20,
    `v${process.versions.node}`,
    'Node.js 20 yoki undan yuqori versiyasini o‘rnating: https://nodejs.org',
  );

  // ---------- 2. .env ----------
  const env = loadEnv();
  report(
    '.env fayli',
    env !== null,
    env ? 'topildi' : 'YO‘Q',
    'Repo ildizida: cp .env.example .env   (Windows PowerShell: copy .env.example .env)',
  );

  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = env ? required.filter((key) => !env[key]) : required;
  if (env) {
    report(
      '.env kalitlari',
      missing.length === 0,
      missing.length ? `yetishmaydi: ${missing.join(', ')}` : required.join(', ') + ' — bor',
      '.env ni .env.example asosida to‘ldiring',
    );
  }

  // ---------- 3. Workspace build artefacts ----------
  const sharedDist = path.join(ROOT, 'packages/shared/dist/index.d.ts');
  report(
    'packages/shared yig‘ilgan',
    existsSync(sharedDist),
    existsSync(sharedDist) ? 'dist/index.d.ts bor' : 'dist YO‘Q',
    'pnpm install   (yoki: pnpm --filter shared build)',
  );

  let prismaOk = false;
  let prismaDetail = 'o‘qib bo‘lmadi';
  try {
    const client = require('@prisma/client');
    prismaOk = typeof client.PrismaClient === 'function';
    prismaDetail = prismaOk
      ? 'PrismaClient generatsiya qilingan'
      : 'PrismaClient YO‘Q (generate qilinmagan)';
  } catch (error) {
    prismaDetail = `topilmadi (${error.code ?? 'xato'})`;
  }
  report(
    'Prisma Client',
    prismaOk,
    prismaDetail,
    'pnpm install   (yoki: pnpm --filter backend prisma generate)',
  );

  // ---------- 4. Infrastructure ----------
  let dbHost = 'localhost';
  let dbPort = 5432;
  if (env?.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      dbHost = url.hostname || dbHost;
      dbPort = Number(url.port || 5432);
    } catch {
      report(
        'DATABASE_URL formati',
        false,
        'noto‘g‘ri URL',
        '.env dagi DATABASE_URL ni tekshiring',
      );
    }
  }

  const dbUp = await tcpCheck(dbHost, dbPort);
  report(
    `PostgreSQL (${dbHost}:${dbPort})`,
    dbUp,
    dbUp ? 'ulanadi' : 'ULANMAYDI',
    'Docker Desktop ochiq bo‘lsin, so‘ng: docker compose up -d   (tekshirish: docker ps)',
  );

  const minioUp = await tcpCheck('localhost', Number(env?.MINIO_PORT ?? 9000));
  report(
    'MinIO (9000)',
    minioUp,
    minioUp ? 'ulanadi' : 'ulanmaydi — faqat foto yuklashga ta’sir qiladi',
    'docker compose up -d',
  );

  // ---------- 5. Database content ----------
  // Without DATABASE_URL there is nothing to query — the missing .env is
  // already reported above, so do not pile a second error on top of it.
  if (prismaOk && dbUp && env?.DATABASE_URL) {
    try {
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient({
        datasources: { db: { url: env.DATABASE_URL } },
        log: [],
      });
      try {
        const applied = await prisma.$queryRawUnsafe(
          'select count(*)::int as count from _prisma_migrations where finished_at is not null',
        );
        const count = applied?.[0]?.count ?? 0;
        report(
          'Migratsiyalar',
          count > 0,
          `${count} ta qo‘llangan`,
          'pnpm --filter backend migrate',
        );

        const users = await prisma.user.count();
        const companies = await prisma.company.count();
        report(
          'Demo ma’lumot',
          users > 0,
          `${users} foydalanuvchi, ${companies} kompaniya`,
          'pnpm --filter backend seed && pnpm --filter backend seed:demo',
        );
      } finally {
        await prisma.$disconnect();
      }
    } catch (error) {
      const message = String(error?.message ?? error).split('\n')[0];
      report(
        'Bazaga ulanish',
        false,
        message.slice(0, 120),
        'Login/parol yoki baza nomini .env dagi DATABASE_URL bilan solishtiring',
      );
    }
  }

  // ---------- 6. Application ports ----------
  const apiPort = Number(env?.API_PORT ?? 3000);
  const apiUp = await tcpCheck('localhost', apiPort, 1500);
  const webUp = await tcpCheck('localhost', 5173, 1500);
  console.log(
    `\nHozirgi holat:  backend :${apiPort} — ${apiUp ? 'ISHLAYAPTI' : 'to‘xtagan'}` +
      `   ·   web :5173 — ${webUp ? 'ISHLAYAPTI' : 'to‘xtagan'}`,
  );

  // ---------- Report ----------
  console.log('');
  for (const item of results) {
    console.log(`${item.ok ? ' OK  ' : ' XATO'}  ${item.name.padEnd(26)} ${item.detail}`);
  }

  console.log('\n' + '='.repeat(38));
  if (!firstProblem) {
    console.log('Hammasi joyida. Ishga tushirish:  pnpm dev');
    if (!apiUp || !webUp) console.log('So‘ng oching: http://localhost:5173');
  } else {
    console.log(`MUAMMO: ${firstProblem.name} — ${firstProblem.detail}`);
    console.log(`YECHIM: ${firstProblem.fix}`);
    console.log('\nTuzatgach shu buyruqni qayta ishga tushiring: pnpm doctor');
  }
  console.log('');
}

main().catch((error) => {
  console.error('doctor ishlamadi:', error);
  process.exitCode = 1;
});
