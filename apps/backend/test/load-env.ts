/**
 * E2E runs need the same .env the app uses (DATABASE_URL, JWT secrets), but
 * jest is started directly rather than through the dotenv-cli wrapper, so the
 * root file is loaded here before any module reads process.env.
 */
import { config } from 'dotenv';
import { join } from 'node:path';

config({ path: join(__dirname, '..', '.env'), quiet: true });
config({ path: join(__dirname, '..', '..', '..', '.env'), quiet: true });

process.env.NODE_ENV ??= 'test';
