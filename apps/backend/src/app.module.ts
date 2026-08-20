import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppExceptionFilter } from './common/filters/app-exception.filter';
import { ThrottleModule } from './common/throttle/throttle.module';
import { AppThrottlerGuard } from './common/throttle/throttle';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { SessionStateModule } from './common/guards/session-state.module';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';
import { RequestLoggerMiddleware } from './common/logging/request-logger.middleware';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { I18nModule } from './i18n/i18n.module';
import { AiModule } from './modules/ai/ai.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { EventsModule } from './modules/events/events.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { FilesModule } from './modules/files/files.module';
import { FinanceModule } from './modules/finance/finance.module';
import { FuelModule } from './modules/fuel/fuel.module';
import { RoutesModule } from './modules/routes/routes.module';
import { PublicLinkModule } from './modules/public-link/public-link.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { TripsModule } from './modules/trips/trips.module';
import { UsersModule } from './modules/users/users.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottleModule,
    PrismaModule,
    SessionStateModule,
    I18nModule,
    AuditModule,
    UsersModule,
    AuthModule,
    CompaniesModule,
    DriversModule,
    ClientsModule,
    VehiclesModule,
    RoutesModule,
    TripsModule,
    EventsModule,
    TrackingModule,
    ExpensesModule,
    FuelModule,
    FinanceModule,
    AiModule,
    FilesModule,
    PublicLinkModule,
    HealthModule,
  ],
  providers: [
    // Order matters: authentication first so the throttler can bucket per user
    // instead of per shared office IP, then roles, then the rate limiter.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route, including the ones a guard rejects: a burst of 401s is
    // exactly the pattern worth being able to query for.
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
