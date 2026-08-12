import { Module } from '@nestjs/common';
import { TripPnlController, VehicleStatsController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  controllers: [TripPnlController, VehicleStatsController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
