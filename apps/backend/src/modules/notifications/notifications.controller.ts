import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { LinkTelegramDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

/** Where a user is reached (TZ §7). Alerts themselves live under /alerts. */
@Controller('notifications')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('telegram')
  state(@CurrentUser() user: CurrentUserPayload) {
    return this.notifications.state(user);
  }

  @Patch('telegram')
  link(@CurrentUser() user: CurrentUserPayload, @Body() dto: LinkTelegramDto) {
    return this.notifications.linkTelegram(user, dto.chatId);
  }

  @Delete('telegram')
  unlink(@CurrentUser() user: CurrentUserPayload) {
    return this.notifications.unlinkTelegram(user);
  }
}
