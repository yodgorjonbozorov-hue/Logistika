import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { FuelController } from './fuel.controller';
import { FuelService } from './fuel.service';

@Module({
  imports: [AlertsModule],
  controllers: [FuelController],
  providers: [FuelService],
  exports: [FuelService],
})
export class FuelModule {}
