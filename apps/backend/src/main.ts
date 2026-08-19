import './common/serialization';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // JSON body cap is applied explicitly below; the default parser is off so
    // an oversized payload is rejected before it reaches a handler (M-1).
    bodyParser: true,
  });
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const jsonLimit = `${config.get<number>('MAX_JSON_BODY_MB', 2)}mb`;

  // Security headers (M-1). The API serves JSON only, so the CSP is locked to
  // "nothing may be loaded or framed", and CORP/COEP defaults stay on.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: isProduction ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    }),
  );
  app.use(compression());

  // Only trust X-Forwarded-* when a reverse proxy really is in front, otherwise
  // clients can forge their own IP and walk past the rate limits.
  const trustProxy = config.get<number>('TRUST_PROXY', 0);
  app.set('trust proxy', trustProxy > 0 ? trustProxy : false);
  app.disable('x-powered-by');

  app.useBodyParser('json', { limit: jsonLimit });
  app.useBodyParser('urlencoded', { limit: jsonLimit, extended: true });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // An unknown field is a client bug or an injection attempt — say so
      // instead of silently dropping it.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: config.getOrThrow<string>('WEB_URL'),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'accept-language'],
    maxAge: 600,
  });
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('API_PORT'));
}

void bootstrap();
