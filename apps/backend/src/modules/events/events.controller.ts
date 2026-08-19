import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ThrottleIngest } from '../../common/throttle/throttle';
import { EventBatchDto, ListEventsDto } from './dto/event.dto';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post('batch')
  @Roles(UserRole.DRIVER)
  @ThrottleIngest()
  @HttpCode(HttpStatus.OK)
  ingestBatch(@CurrentUser() user: CurrentUserPayload, @Body() dto: EventBatchDto) {
    return this.eventsService.ingestBatch(user, dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER)
  listByTrip(@CurrentUser() user: CurrentUserPayload, @Query() query: ListEventsDto) {
    return this.eventsService.listByTrip(user, query.tripId);
  }
}
