import { Module } from '@nestjs/common';
import { ExpensesController, IncomesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  controllers: [ExpensesController, IncomesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
