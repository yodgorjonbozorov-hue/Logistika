import './common/serialization';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();

  await app.listen(app.get(ConfigService).getOrThrow<number>('API_PORT'));
}

void bootstrap();
