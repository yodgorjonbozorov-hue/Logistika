import { Controller, Get } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserPayload) {
    return this.dashboardService.summary(user);
  }
}
