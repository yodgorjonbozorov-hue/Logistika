/**
 * The Nest application factory shared by both entry points: `main.ts` (a normal
 * long-running server) and `serverless.ts` (one Vercel Function). Keeping the
 * global prefix, pipes and CORS in one place stops the two from drifting.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createOriginCheck } from './common/cors';

export const API_PREFIX = 'api/v1';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const isAllowedOrigin = createOriginCheck({
    allowed: config.getOrThrow<string>('WEB_URL'),
    previewSuffix: config.get<string>('WEB_PREVIEW_SUFFIX'),
  });
  app.enableCors({
    // The `cors` package takes a callback, not a bare predicate.
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
  });
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  return app;
}
