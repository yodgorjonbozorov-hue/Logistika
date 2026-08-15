import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { CompaniesModule } from '../companies/companies.module';
import { FuelController } from './fuel.controller';
import { FuelService } from './fuel.service';

@Module({
  imports: [AlertsModule, CompaniesModule],
  controllers: [FuelController],
  providers: [FuelService],
  exports: [FuelService],
})
export class FuelModule {}
