import './common/serialization';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { initSentry } from './common/observability/sentry';

async function bootstrap(): Promise<void> {
  // Before anything else, so a failure during startup is reported too.
  initSentry(
    process.env.SENTRY_DSN,
    process.env.NODE_ENV ?? 'development',
    process.env.APP_VERSION,
  );

  const app = configureApp(await NestFactory.create(AppModule, { bufferLogs: true }));
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  await app.listen(app.get(ConfigService).getOrThrow<number>('API_PORT'));
}

void bootstrap();
