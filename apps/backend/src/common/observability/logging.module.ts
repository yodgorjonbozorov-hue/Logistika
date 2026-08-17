import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CurrentUserPayload } from 'shared';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Structured JSON logging.
 *
 * Free-text logs are unsearchable the moment something goes wrong at 3am: with
 * one line per request carrying requestId, userId, companyId and duration, "who
 * did this and how long did it take" is a query rather than an archaeology
 * exercise. The request id also goes back in a response header, so a user can
 * quote it in a support message.
 *
 * Anything that could carry a secret — Authorization, cookies, passwords,
 * tokens — is redacted before it is written.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';
        return {
          pinoHttp: {
            level: config.get<string>('LOG_LEVEL') ?? (isProduction ? 'info' : 'debug'),
            // Readable locally, JSON in production where something parses it.
            transport: isProduction ? undefined : { target: 'pino-pretty' },
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const existing = req.headers[REQUEST_ID_HEADER];
              const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
              res.setHeader(REQUEST_ID_HEADER, id);
              return id;
            },
            customProps: (req: IncomingMessage) => {
              const user = (req as IncomingMessage & { user?: CurrentUserPayload }).user;
              return { userId: user?.userId, companyId: user?.companyId };
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                'req.body.password',
                'req.body.currentPassword',
                'req.body.newPassword',
                'req.body.refreshToken',
                'req.body.token',
                'req.body.code',
              ],
              censor: '[redacted]',
            },
            // Health checks would otherwise dominate the log volume.
            autoLogging: {
              ignore: (req: IncomingMessage) => req.url?.startsWith('/api/v1/health') ?? false,
            },
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
