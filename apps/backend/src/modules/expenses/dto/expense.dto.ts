import { PartialType } from '@nestjs/mapped-types';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { Currency, ExpenseCategory } from 'shared';
import { IsTiyin } from '../../../common/dto/money';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { IsWithinDateWindow, RECORDED_DATE_WINDOW } from '../../../common/dto/date-bounds';

export class CreateExpenseDto {
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @IsTiyin()
  amount!: string;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsTiyin()
  unitPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptPhoto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  paymentMethod?: string;

  @IsDateString()
  @IsWithinDateWindow(RECORDED_DATE_WINDOW)
  expenseDate!: string;
}

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}

export class ListExpensesDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsEnum(ExpenseCategory)
  category?: ExpenseCategory;
}

export class CreateIncomeDto {
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsTiyin()
  amount!: string;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsDateString()
  @IsWithinDateWindow(RECORDED_DATE_WINDOW)
  paymentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoiceNumber?: string;

  // `status` is deliberately absent: it is derived from the ledger (how much of
  // the trip's invoice this and earlier payments cover), not typed in. It used
  // to be a free-form <Select> on the finance page, so anyone could mark an
  // unpaid trip PAID and nothing anywhere disagreed.
}

export class UpdateIncomeDto extends PartialType(CreateIncomeDto) {}

/**
 * Why an expense is being cancelled.
 *
 * Required and long enough to be a sentence, for the same reason a trip's
 * failure needs one: "correction" tells the person reviewing a loss-making
 * month in six weeks exactly nothing.
 */
export class ReverseExpenseDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
