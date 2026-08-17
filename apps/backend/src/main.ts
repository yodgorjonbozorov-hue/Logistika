import './common/serialization';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // nginx sets these too in the production stack; setting them here as well
  // means a deployment behind a different proxy is not left bare
  // (docs/SECURITY.md F-8). The API serves JSON, so no CSP is needed for it.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: config.getOrThrow<string>('WEB_URL'), credentials: true });
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('API_PORT'));
}

void bootstrap();
