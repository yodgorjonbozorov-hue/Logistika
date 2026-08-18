/**
 * Runs a command with the monorepo's `.env` loaded.
 *
 * The Prisma CLI and the seed scripts only look for `.env` next to the package
 * they run in, but this repo keeps one `.env` at the root (README, CLAUDE.md).
 * This wrapper bridges the two without adding a dependency.
 *
 *   node scripts/with-env.mjs prisma migrate deploy
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Minimal dotenv reader: KEY=VALUE lines, `#` comments, optional quotes. */
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // A real environment variable always wins over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Package-local first, then the repo root — the more specific file wins.
loadEnvFile(path.join(here, '..', '.env'));
loadEnvFile(path.join(here, '..', '..', '..', '.env'));

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with-env.mjs <command> [args…]');
  process.exit(2);
}

const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
