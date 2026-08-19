import './common/serialization';
import { ConfigService } from '@nestjs/config';
import { createApp } from './create-app';

/** Long-running server entry (local dev, Docker). Vercel uses `serverless.ts`. */
async function bootstrap(): Promise<void> {
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService).getOrThrow<number>('API_PORT'));
}

void bootstrap();
