import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, seconds } from '@nestjs/throttler';
import type { CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { Public } from '../../common/decorators/public.decorator';
import { THROTTLERS } from '../../common/throttling/throttling.module';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  clearRefreshCookie,
  readRefreshToken,
  setRefreshCookie,
} from './refresh-cookie';
import { PasswordService } from './password.service';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto';
import { DriverAuthService } from './driver-auth.service';
import { RequestCodeDto, VerifyCodeDto } from './dto/driver-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

/** Matches JWT_REFRESH_TTL's default of 30 days. */
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Native clients announce themselves with `X-Client: mobile`; everything else
 * is treated as a browser and gets the cookie.
 */
function prefersCookie(req: Request): boolean {
  return String(req.headers['x-client'] ?? '').toLowerCase() !== 'mobile';
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly driverAuthService: DriverAuthService,
    private readonly passwordService: PasswordService,
    private readonly config: ConfigService,
  ) {}

  private get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Browsers get the refresh token as an httpOnly cookie and never see it in
   * the response body; native clients, which have no cookie jar, still get it
   * in the body. The `client` field is how the two are told apart.
   */
  private issue(
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
    wantsCookie: boolean,
  ) {
    if (!wantsCookie) return tokens;
    setRefreshCookie(res, tokens.refreshToken, this.isProduction, REFRESH_MAX_AGE_MS);
    return { accessToken: tokens.accessToken };
  }

  // SMS costs money and a flood locks the driver out of their own account:
  // 3/hour per phone number and 10/hour per IP.
  @Throttle({
    [THROTTLERS.phone]: { limit: 3, ttl: seconds(3600) },
    [THROTTLERS.ip]: { limit: 10, ttl: seconds(3600) },
  })
  @Public()
  @Post('driver/request-code')
  @HttpCode(HttpStatus.OK)
  requestCode(@Body() dto: RequestCodeDto) {
    return this.driverAuthService.requestCode(dto.phone);
  }

  @Throttle({ [THROTTLERS.phone]: { limit: 10, ttl: seconds(3600) } })
  @Public()
  @Post('driver/verify')
  @HttpCode(HttpStatus.OK)
  async verifyCode(
    @Body() dto: VerifyCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.driverAuthService.verify(dto.phone, dto.code);
    return this.issue(res, tokens, prefersCookie(req));
  }

  // Password brute force: 5/minute per IP and 10/hour per account.
  @Throttle({
    [THROTTLERS.ip]: { limit: 5, ttl: seconds(60) },
    [THROTTLERS.identifier]: { limit: 10, ttl: seconds(3600) },
  })
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const tokens = await this.authService.login(dto.identifier, dto.password);
    return this.issue(res, tokens, prefersCookie(req));
  }

  @Throttle({ [THROTTLERS.ip]: { limit: 30, ttl: seconds(60) } })
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readRefreshToken(req, dto.refreshToken);
    if (!token) {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }
    try {
      const tokens = await this.authService.refresh(token);
      return this.issue(res, tokens, prefersCookie(req));
    } catch (error) {
      // A dead token should not leave a stale cookie behind to be retried.
      clearRefreshCookie(res, this.isProduction);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readRefreshToken(req, dto.refreshToken);
    if (token) await this.authService.logout(token);
    clearRefreshCookie(res, this.isProduction);
    return { loggedOut: true };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: CurrentUserPayload, @Body() dto: ChangePasswordDto) {
    return this.passwordService.changePassword(user, dto);
  }

  // Same rate limit as code requests: a reset message costs money to send and
  // is a nuisance to receive.
  @Throttle({
    [THROTTLERS.identifier]: { limit: 3, ttl: seconds(3600) },
    [THROTTLERS.ip]: { limit: 10, ttl: seconds(3600) },
  })
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordService.forgotPassword(dto.identifier);
  }

  @Throttle({ [THROTTLERS.ip]: { limit: 10, ttl: seconds(3600) } })
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordService.resetPassword(dto);
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.me(user.userId);
  }
}
