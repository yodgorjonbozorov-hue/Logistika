import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DateRangeDto } from './dto/finance.dto';
import { FinanceService } from './finance.service';

/** Read-only reporting (TZ §6). Logists see operations; money stays with the
 * owner and the accountant. */
@Controller('finance')
@Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserPayload, @Query() range: DateRangeDto) {
    return this.financeService.summary(user, range);
  }

  @Get('trips/:id')
  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT, UserRole.LOGIST)
  tripPnl(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.tripPnl(user, id);
  }

  @Get('vehicles/:id')
  vehicleStats(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() range: DateRangeDto,
  ) {
    return this.financeService.vehicleStats(user, id, range);
  }
}
