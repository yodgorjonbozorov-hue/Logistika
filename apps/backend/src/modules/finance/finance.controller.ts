import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { ApiPayload } from '../../common/interceptors/api-response.interceptor';
import { FinancePeriodDto, FinanceTripsDto, MonthlyDto } from './dto/finance-query.dto';
import { FinanceService } from './finance.service';

/**
 * Finance analytics (TZ §6, W-1/W-7/W-9).
 *
 * Read-only. Restricted to the roles that are supposed to see company money:
 * a DRIVER has no business with the fleet's margins, and the roles guard —
 * not the web app's menu — is what enforces that.
 */
@Controller('finance')
@Roles(UserRole.OWNER, UserRole.ACCOUNTANT, UserRole.LOGIST)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  /** Turns the DTO's range complaint into the project's error envelope. */
  private validated<T extends FinancePeriodDto>(period: T): T {
    try {
      period.assertValid();
    } catch (error) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        error instanceof Error ? error.message : 'invalid period',
      ]);
    }
    return period;
  }

  /** Company-wide revenue, expenses, profit and the operational counters. */
  @Get('summary')
  summary(@CurrentUser() user: CurrentUserPayload, @Query() period: FinancePeriodDto) {
    return this.finance.summary(user, this.validated(period));
  }

  /** P&L per trip, paginated. */
  @Get('trips')
  async trips(@CurrentUser() user: CurrentUserPayload, @Query() query: FinanceTripsDto) {
    const { data, total } = await this.finance.byTrip(user, this.validated(query));
    return new ApiPayload(data, {
      pagination: { page: query.page, limit: query.limit, total },
    });
  }

  /** P&L per route — "qaysi yo'nalishlarga nechta reys va qancha foyda". */
  @Get('routes')
  routes(@CurrentUser() user: CurrentUserPayload, @Query() period: FinancePeriodDto) {
    return this.finance.byRoute(user, this.validated(period));
  }

  /** P&L per truck, including expenses booked against the vehicle itself. */
  @Get('vehicles')
  vehicles(@CurrentUser() user: CurrentUserPayload, @Query() period: FinancePeriodDto) {
    return this.finance.byVehicle(user, this.validated(period));
  }

  /** Month-by-month series with the change against the previous month. */
  @Get('monthly')
  monthly(@CurrentUser() user: CurrentUserPayload, @Query() query: MonthlyDto) {
    return this.finance.monthly(user, query);
  }

  /** Fuel volume, cost and consumption against each vehicle's norm. */
  @Get('fuel')
  fuel(@CurrentUser() user: CurrentUserPayload, @Query() period: FinancePeriodDto) {
    return this.finance.fuel(user, this.validated(period));
  }
}
