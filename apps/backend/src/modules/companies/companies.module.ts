import { Module } from '@nestjs/common';
import { AdminCompaniesController, CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { SettingsService } from './settings.service';

@Module({
  controllers: [CompaniesController, AdminCompaniesController],
  providers: [CompaniesService, SettingsService],
  exports: [CompaniesService, SettingsService],
})
export class CompaniesModule {}
