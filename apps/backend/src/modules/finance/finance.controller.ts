import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PeriodDto } from '../../common/dto/period.dto';
import { FinanceService } from './finance.service';

/** GET /trips/:id/pnl — W-4 «Moliya» tab (ARCHITECTURE.md API contract). */
@Controller('trips')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class TripPnlController {
  constructor(private readonly financeService: FinanceService) {}

  @Get(':id/pnl')
  pnl(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.tripPnl(user, id);
  }
}

/** GET /vehicles/:id/stats — W-5 monthly income/cost, cost per km, ROI. */
@Controller('vehicles')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class VehicleStatsController {
  constructor(private readonly financeService: FinanceService) {}

  @Get(':id/stats')
  stats(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() period: PeriodDto,
  ) {
    return this.financeService.vehicleStats(user, id, period.fromDate, period.toDate);
  }
}
