import { Module } from '@nestjs/common';
import { FuelModule } from '../fuel/fuel.module';
import { TrackingModule } from '../tracking/tracking.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [FuelModule, TrackingModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
