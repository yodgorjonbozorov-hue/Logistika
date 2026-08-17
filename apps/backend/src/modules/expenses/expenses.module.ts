import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { ExpensesController, IncomesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [LedgerModule],
  controllers: [ExpensesController, IncomesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
