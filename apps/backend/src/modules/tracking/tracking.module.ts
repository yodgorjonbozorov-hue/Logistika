import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { CompaniesModule } from '../companies/companies.module';
import { EventsModule } from '../events/events.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { WatchService } from './watch.service';

@Module({
  imports: [EventsModule, AlertsModule, CompaniesModule],
  controllers: [TrackingController],
  providers: [TrackingService, WatchService],
  exports: [TrackingService, WatchService],
})
export class TrackingModule {}
