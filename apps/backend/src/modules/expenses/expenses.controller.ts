import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { paginated } from '../../common/dto/pagination.dto';
import {
  CreateExpenseDto,
  CreateIncomeDto,
  ListExpensesDto,
  UpdateExpenseDto,
  ReverseExpenseDto,
  UpdateIncomeDto,
} from './dto/expense.dto';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListExpensesDto) {
    const page = await this.expensesService.listExpenses(user, filter);
    return paginated(page, filter);
  }

  @Post()
  @Idempotent()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateExpenseDto) {
    return this.expensesService.createExpense(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.updateExpense(user, id, dto);
  }

  @Post(':id/approve')
  @Idempotent()
  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.expensesService.approveExpense(user, id);
  }

  /**
   * Cancels an expense with a mirrored row rather than editing or deleting it
   * (L-8). The reason is required: a correction nobody explained is a number
   * that changed for no recorded reason.
   */
  @Post(':id/reverse')
  @Idempotent()
  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  @HttpCode(HttpStatus.OK)
  reverse(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseExpenseDto,
  ) {
    return this.expensesService.reverseExpense(user, id, dto.reason);
  }

  @Delete(':id')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.expensesService.removeExpense(user, id);
  }
}

@Controller('incomes')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class IncomesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListExpensesDto) {
    const page = await this.expensesService.listIncomes(user, filter);
    return paginated(page, filter);
  }

  @Post()
  @Idempotent()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateIncomeDto) {
    return this.expensesService.createIncome(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncomeDto,
  ) {
    return this.expensesService.updateIncome(user, id, dto);
  }
}
