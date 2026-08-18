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
// Jobs run in-process here (TASK-4.3): a test that asks "is the photo compressed
// yet" should not be answering "depends how busy the broker is". The handler code
// is the same either way, so what is tested is still the real handler.
process.env.JOBS_INLINE ??= 'true';
