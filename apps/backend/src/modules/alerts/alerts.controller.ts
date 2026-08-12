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
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto, paginated } from '../../common/dto/pagination.dto';
import { AlertsService } from './alerts.service';

class ListAlertsDto extends PaginationDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unread?: boolean;
}

@Controller('alerts')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListAlertsDto) {
    const { data, total } = await this.alertsService.list(user, filter, filter.unread === true);
    return paginated(data, filter, total);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: CurrentUserPayload) {
    return this.alertsService.unreadCount(user);
  }

  @Post('ack-all')
  @HttpCode(HttpStatus.OK)
  ackAll(@CurrentUser() user: CurrentUserPayload) {
    return this.alertsService.ackAll(user);
  }

  @Post(':id/ack')
  @HttpCode(HttpStatus.OK)
  ack(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.alertsService.ack(user, id);
  }
}
