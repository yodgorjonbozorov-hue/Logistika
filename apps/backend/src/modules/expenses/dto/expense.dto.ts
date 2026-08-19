import { OmitType, PartialType } from '@nestjs/mapped-types';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Currency, ExpenseCategory, PaymentStatus } from 'shared';
import { IsPositiveTiyin, IsTiyin } from '../../../common/dto/money';
import { PaginationDto } from '../../../common/dto/pagination.dto';

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

  @IsPositiveTiyin()
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
  expenseDate!: string;

  /**
   * Client-generated idempotency key. Re-sending the same key returns the
   * original row instead of booking the money a second time (H-3).
   */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_:-]{8,64}$/, {
    message: 'clientTxId must be 8-64 chars of [A-Za-z0-9_:-]',
  })
  clientTxId?: string;
}

/** The idempotency key belongs to the creating request only — it is not editable. */
export class UpdateExpenseDto extends PartialType(
  OmitType(CreateExpenseDto, ['clientTxId'] as const),
) {}

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

  @IsPositiveTiyin()
  amount!: string;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoiceNumber?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /**
   * Client-generated idempotency key. Re-sending the same key returns the
   * original row instead of booking the money a second time (H-3).
   */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_:-]{8,64}$/, {
    message: 'clientTxId must be 8-64 chars of [A-Za-z0-9_:-]',
  })
  clientTxId?: string;
}

export class UpdateIncomeDto extends PartialType(
  OmitType(CreateIncomeDto, ['clientTxId'] as const),
) {}
