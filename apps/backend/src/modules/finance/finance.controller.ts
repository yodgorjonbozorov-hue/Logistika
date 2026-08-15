import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PeriodDto } from './dto/finance.dto';
import { FinanceService } from './finance.service';

@Controller('finance')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserPayload, @Query() period: PeriodDto) {
    return this.financeService.summary(user, period);
  }

  @Get('trips/:id')
  tripPnl(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.tripPnl(user, id);
  }

  @Get('vehicles')
  fleet(@CurrentUser() user: CurrentUserPayload, @Query() period: PeriodDto) {
    return this.financeService.fleetEconomics(user, period);
  }

  @Get('receivables')
  receivables(@CurrentUser() user: CurrentUserPayload) {
    return this.financeService.receivables(user);
  }
}
