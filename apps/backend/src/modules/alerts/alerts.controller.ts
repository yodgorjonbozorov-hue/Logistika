import { Controller, Get } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AlertsService } from './alerts.service';

/** W-10 — what needs attention right now, derived on read. */
@Controller('alerts')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.alertsService.list(user);
  }
}
