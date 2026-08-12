import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { ExpensesController, IncomesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [AlertsModule],
  controllers: [ExpensesController, IncomesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
