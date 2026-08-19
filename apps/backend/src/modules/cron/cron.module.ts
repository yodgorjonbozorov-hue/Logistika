import { Module } from '@nestjs/common';
import { TrackingModule } from '../tracking/tracking.module';
import { CronController } from './cron.controller';

@Module({
  imports: [TrackingModule],
  controllers: [CronController],
})
export class CronModule {}
