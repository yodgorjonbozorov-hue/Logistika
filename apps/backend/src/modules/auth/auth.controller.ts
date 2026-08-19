import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly driverAuthService: DriverAuthService,
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
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.driverAuthService.verify(dto.phone, dto.code);
  }

  @Public()
  @Post('login')
  @ThrottleLogin()
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.identifier, dto.password);
  }

  @Public()
  @Post('refresh')
  @ThrottleRefresh()
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
    return { loggedOut: true };
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.me(user.userId);
  }
}
