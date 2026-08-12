// Assembles the static site for Vercel: landing at /, demo app at /app/.
// Run via `pnpm build:site` (after shared + web demo builds).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-site');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'app'), { recursive: true });
cpSync(join(root, 'apps/landing/index.html'), join(out, 'index.html'));
cpSync(join(root, 'apps/web/dist/index.html'), join(out, 'app/index.html'));
process.stdout.write('dist-site/ ready: / (landing), /app/ (demo)\n');
