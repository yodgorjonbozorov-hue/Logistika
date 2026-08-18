import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';

/**
 * Everything that turns a bare Nest application into *this* API.
 *
 * It lives here rather than in main.ts so the e2e suite exercises the same
 * pipeline the server runs — security headers, body limits and validation
 * included. A test app that skips them proves nothing about production.
 */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(ConfigService);

  // Security headers: CSP, HSTS, X-Frame-Options, noSniff and friends.
  app.use(helmet());
  // An unbounded JSON body is a free denial of service; uploads go through
  // multer and are limited separately.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  // The refresh token arrives as an httpOnly cookie for browser clients.
  app.use(cookieParser());

  app.setGlobalPrefix('api/v1');
  // forbidNonWhitelisted, not just whitelist: an unknown field used to be
  // dropped in silence, so a client sending `amout` instead of `amount` got a
  // 201 and an expense of zero. Being told is the whole point (M-22).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({ origin: config.getOrThrow<string>('WEB_URL'), credentials: true });

  return app;
}
