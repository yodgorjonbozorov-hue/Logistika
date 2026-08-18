import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateExpenseDto } from './modules/expenses/dto/expense.dto';

/** Does the backend accept what the client's checkAmount/checkRecordedDate allow? */
const errorsFor = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(CreateExpenseDto, body), { whitelist: true })
    .flatMap((e) => Object.values(e.constraints ?? {}));

it('probe', () => {
  const base = { category: 'FUEL', expenseDate: new Date().toISOString() };
  for (const amount of ['1250000', '99999999999999999', '1', '0']) {
    console.log(`amount=${amount} ->`, errorsFor({ ...base, amount }));
  }
  const day = 24 * 60 * 60 * 1000;
  for (const offset of [0, -day, +day - 60_000, 30 * day]) {
    console.log(
      `date offset=${offset / day}d ->`,
      errorsFor({ ...base, amount: '100', expenseDate: new Date(Date.now() + offset).toISOString() }),
    );
  }
});
