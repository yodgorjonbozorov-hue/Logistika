#!/usr/bin/env node
/**
 * Folds the offline preview build into the deployed site at `/demo`, so the
 * hosted URL shows a working interface even before an API is connected.
 * Run after both web builds — see the `build:vercel` script.
 */
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps/web/dist-demo');
const target = path.join(root, 'apps/web/dist/demo');

async function exists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(source))) {
  console.error(`[stage-demo] ${source} is missing — run "pnpm --filter web build:demo" first.`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

// The preview's entry is demo.html; the directory serves it as its index.
const entry = path.join(target, 'demo.html');
if (await exists(entry)) {
  await rename(entry, path.join(target, 'index.html'));
}

console.log(`[stage-demo] ${path.relative(root, target)} ←`, (await readdir(target)).join(', '));
