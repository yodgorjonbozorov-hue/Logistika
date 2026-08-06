import './common/serialization';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: config.getOrThrow<string>('WEB_URL'), credentials: true });
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('API_PORT'));
}

void bootstrap();
