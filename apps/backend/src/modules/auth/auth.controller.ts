import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AuthTokens, CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import {
  PhoneRateLimit,
  PhoneRateLimitGuard,
  ThrottleLogin,
  ThrottleRefresh,
  ThrottleSms,
  ThrottleSmsVerify,
} from '../../common/throttle/throttle';
import { AuthService } from './auth.service';
import { DriverAuthService } from './driver-auth.service';
import { RequestCodeDto, VerifyCodeDto } from './dto/driver-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import {
  clearRefreshCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
  type CookieContext,
  type CookieSameSite,
} from './refresh-cookie';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly driverAuthService: DriverAuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('driver/request-code')
  // Two independent budgets: per caller (IP) and per victim phone number.
  @ThrottleSms()
  @PhoneRateLimit(1)
  @UseGuards(PhoneRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  requestCode(@Body() dto: RequestCodeDto) {
    return this.driverAuthService.requestCode(dto.phone);
  }

  @Public()
  @Post('driver/verify')
  @ThrottleSmsVerify()
  @HttpCode(HttpStatus.OK)
  async verifyCode(
    @Body() dto: VerifyCodeDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokens> {
    return this.issue(await this.driverAuthService.verify(dto.phone, dto.code), response);
  }

  @Public()
  @Post('login')
  @ThrottleLogin()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokens> {
    return this.issue(await this.authService.login(dto.identifier, dto.password), response);
  }

  @Public()
  @Post('refresh')
  @ThrottleRefresh()
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthTokens> {
    this.assertSameOrigin(request);
    return this.issue(await this.authService.refresh(this.readToken(dto, request)), response);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertSameOrigin(request);
    await this.authService.logout(this.readToken(dto, request));
    clearRefreshCookie(response, this.cookieContext);
    return { loggedOut: true };
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.me(user.userId);
  }

  private get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private get cookieContext(): CookieContext {
    return {
      isProduction: this.isProduction,
      sameSite: this.config.get<CookieSameSite>('AUTH_COOKIE_SAMESITE', 'strict'),
    };
  }

  /**
   * Rejects a cross-site request that carries the refresh cookie.
   *
   * `SameSite=Strict` is what normally makes this unnecessary — the browser
   * simply never attaches the cookie to someone else's request. A cross-site
   * deployment cannot use Strict (see refresh-cookie.ts), and `None` hands that
   * protection back: an attacker's page could POST a form to /auth/refresh, the
   * browser would attach the victim's cookie, and the token would rotate. The
   * attacker cannot read the response — CORS sees to that — but the victim's
   * own next refresh then presents a superseded token, reuse detection fires,
   * and the whole family is revoked. A forced logout, on demand, from any site
   * the user happens to visit.
   *
   * `Origin` is set by browsers on every POST, including the cross-site form
   * post that is the whole attack, and cannot be forged by page JavaScript.
   * Native clients send none and are unaffected — they carry the token in the
   * body rather than a cookie.
   */
  private assertSameOrigin(request: Request): void {
    const origin = request.headers.origin;
    if (!origin) return;
    if (origin === this.config.getOrThrow<string>('WEB_URL')) return;
    throw new AppException('AUTH_FORBIDDEN', HttpStatus.FORBIDDEN);
  }

  /**
   * Browsers get the refresh token as an httpOnly cookie; native clients read
   * it from the body. Both are issued so one backend serves both without a
   * per-client branch (H-16).
   */
  private issue(tokens: AuthTokens, response: Response): AuthTokens {
    setRefreshCookie(response, tokens.refreshToken, {
      ...this.cookieContext,
      ttl: this.config.getOrThrow<string>('JWT_REFRESH_TTL'),
    });
    return tokens;
  }

  /**
   * The cookie wins over the body: a browser session should not be steerable by
   * whatever a script managed to put in the request payload.
   */
  private readToken(dto: RefreshDto, request: Request): string {
    const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
    const token = cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
    if (!token) {
      throw new AppException('AUTH_REFRESH_INVALID', HttpStatus.UNAUTHORIZED);
    }
    return token;
  }
}
