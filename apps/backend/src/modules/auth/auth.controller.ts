import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import type { CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { THROTTLERS } from '../../common/throttling/throttling.module';
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
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.driverAuthService.verify(dto.phone, dto.code);
  }

  // Password brute force: 5/minute per IP and 10/hour per account.
  @Throttle({
    [THROTTLERS.ip]: { limit: 5, ttl: seconds(60) },
    [THROTTLERS.identifier]: { limit: 10, ttl: seconds(3600) },
  })
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.identifier, dto.password);
  }

  @Throttle({ [THROTTLERS.ip]: { limit: 30, ttl: seconds(60) } })
  @Public()
  @Post('refresh')
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
