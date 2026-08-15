import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiPayload } from '../../common/interceptors/api-response.interceptor';
import { AlertsService } from './alerts.service';
import { ListAlertsDto } from './dto/alert.dto';

@Controller('alerts')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListAlertsDto) {
    const { data, total, unread } = await this.alertsService.list(user, filter);
    return new ApiPayload(data, {
      pagination: { page: filter.page, limit: filter.limit, total },
      unread,
    });
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.alertsService.markRead(user, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: CurrentUserPayload) {
    return this.alertsService.markAllRead(user);
  }
}
