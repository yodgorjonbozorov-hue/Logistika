import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';
import { ThrottlingModule } from './common/throttling/throttling.module';
import { validateEnv } from './config/env.validation';
import { HealthController } from './health.controller';
import { I18nModule } from './i18n/i18n.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { EventsModule } from './modules/events/events.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { FilesModule } from './modules/files/files.module';
import { PublicLinkModule } from './modules/public-link/public-link.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { TripsModule } from './modules/trips/trips.module';
import { UsersModule } from './modules/users/users.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // The single .env lives at the monorepo root; the backend is started with its own
    // package directory as cwd, so the root file is listed explicitly. A local
    // apps/backend/.env still wins when present (first match takes precedence).
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env', join(__dirname, '..', '..', '..', '.env')],
    }),
    ScheduleModule.forRoot(),
    ThrottlingModule,
    PrismaModule,
    I18nModule,
    AuditModule,
    UsersModule,
    AuthModule,
    CompaniesModule,
    DriversModule,
    ClientsModule,
    VehiclesModule,
    TripsModule,
    EventsModule,
    TrackingModule,
    ExpensesModule,
    FilesModule,
    PublicLinkModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
