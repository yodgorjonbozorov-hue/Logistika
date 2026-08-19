import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [DriversModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
