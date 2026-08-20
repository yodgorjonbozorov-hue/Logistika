import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';
import type { CurrentUserPayload, UserRole } from 'shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';
import { identifyRequest } from '../logging/request-context';
import { SessionStateService } from './session-state.service';

interface AccessTokenPayload {
  sub: string;
  companyId: string | null;
  role: UserRole;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly sessionState: SessionStateService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: CurrentUserPayload }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new AppException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new AppException('AUTH_TOKEN_EXPIRED', HttpStatus.UNAUTHORIZED);
      }
      throw new AppException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }

    // M-17: a valid signature is not the same as a valid session. A deactivated
    // user, a suspended company or a lapsed subscription must stop working now,
    // not whenever the access token happens to expire.
    await this.sessionState.assertUsable(payload.sub);

    request.user = {
      userId: payload.sub,
      companyId: payload.companyId,
      role: payload.role,
    };
    // Anything logged from here on — including inside a service that knows
    // nothing about HTTP — carries who and which company it was for.
    identifyRequest(payload.sub, payload.companyId);
    return true;
  }
}
