import './common/serialization';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { redact } from './common/logging/redact';

/**
 * A process that keeps running after an uncaught exception is in an unknown
 * state and will serve wrong answers rather than no answers; a rejected promise
 * nobody handled is the same failure with a quieter shape. Both are logged
 * (redacted — the reason is frequently a driver error carrying a connection
 * string) and then the process exits so the orchestrator replaces it.
 *
 * Installed before the application is created, or a failure during bootstrap
 * itself would go to Node's default handler and print unredacted.
 */
function installCrashHandlers(): void {
  const logger = new Logger('Process');

  process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    logger.error('Unhandled promise rejection — exiting', redact(detail));
    process.exitCode = 1;
    // Give the log a tick to flush before the process goes away.
    setTimeout(() => process.exit(1), 100).unref();
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — exiting', redact(error.stack ?? error.message));
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 100).unref();
  });
}

async function bootstrap(): Promise<void> {
  installCrashHandlers();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // JSON body cap is applied explicitly below; the default parser is off so
    // an oversized payload is rejected before it reaches a handler (M-1).
    bodyParser: true,
    // `debug` and `verbose` are off in production: they are the levels that
    // print arguments, and arguments are where the credentials are.
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
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
  // Refresh tokens travel as an httpOnly cookie for browser clients (H-16).
  app.use(cookieParser());

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
