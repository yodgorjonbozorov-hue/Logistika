import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';
import type { CurrentUserPayload, UserRole } from 'shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';
import { TokenVersionService } from '../auth/token-version.service';

interface AccessTokenPayload {
  sub: string;
  companyId: string | null;
  role: UserRole;
  /** Generation the token was minted against (M-2, L-2). */
  tv?: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly tokenVersions: TokenVersionService,
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

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      // A valid signature is not enough: a role change, a deactivation, a
      // password change or a logout all bump the user's version, and a token
      // minted before that must stop working now rather than in 15 minutes.
      const current = await this.tokenVersions.currentFor(payload.sub);
      if (current === null || (payload.tv ?? 0) !== current) {
        throw new AppException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
      }

      request.user = {
        userId: payload.sub,
        companyId: payload.companyId,
        role: payload.role,
      };
      return true;
    } catch (error) {
      if (error instanceof AppException) throw error;
      if (error instanceof TokenExpiredError) {
        throw new AppException('AUTH_TOKEN_EXPIRED', HttpStatus.UNAUTHORIZED);
      }
      throw new AppException('AUTH_TOKEN_INVALID', HttpStatus.UNAUTHORIZED);
    }
  }
}
