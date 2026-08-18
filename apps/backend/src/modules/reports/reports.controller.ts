import { Controller, Get, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportRangeDto } from './dto/report.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('trips')
  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT, UserRole.LOGIST)
  trips(@CurrentUser() user: CurrentUserPayload, @Query() query: ReportRangeDto) {
    return this.reportsService.trips(user, this.reportsService.resolveRange(query.from, query.to));
  }

  @Get('finance')
  finance(@CurrentUser() user: CurrentUserPayload, @Query() query: ReportRangeDto) {
    return this.reportsService.finance(
      user,
      this.reportsService.resolveRange(query.from, query.to),
    );
  }

  @Get('vehicles')
  vehicles(@CurrentUser() user: CurrentUserPayload, @Query() query: ReportRangeDto) {
    return this.reportsService.vehicles(
      user,
      this.reportsService.resolveRange(query.from, query.to),
    );
  }

  @Get('drivers')
  drivers(@CurrentUser() user: CurrentUserPayload, @Query() query: ReportRangeDto) {
    return this.reportsService.drivers(
      user,
      this.reportsService.resolveRange(query.from, query.to),
    );
  }
}
