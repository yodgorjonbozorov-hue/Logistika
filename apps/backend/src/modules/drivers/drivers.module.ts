import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { RatingService } from './rating.service';

@Module({
  imports: [CompaniesModule],
  controllers: [DriversController],
  providers: [DriversService, RatingService],
  exports: [DriversService, RatingService],
})
export class DriversModule {}
