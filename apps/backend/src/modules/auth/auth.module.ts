import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DriverAuthService } from './driver-auth.service';
import { RegistrationService } from './registration.service';
import { SmsService } from './sms.service';

@Module({
  // Secrets are passed per sign/verify call (access vs refresh differ).
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [AuthService, DriverAuthService, RegistrationService, SmsService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
