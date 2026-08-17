import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [LedgerModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
