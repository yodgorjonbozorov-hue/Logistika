import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { THROTTLERS } from '../../common/throttling/throttling.module';
import { EventBatchDto } from './dto/event.dto';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Throttle({ [THROTTLERS.user]: { limit: 60, ttl: seconds(60) } })
  @Post('batch')
  @Roles(UserRole.DRIVER)
  @HttpCode(HttpStatus.OK)
  ingestBatch(@CurrentUser() user: CurrentUserPayload, @Body() dto: EventBatchDto) {
    return this.eventsService.ingestBatch(user, dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER)
  listByTrip(@CurrentUser() user: CurrentUserPayload, @Query('tripId') tripId: string) {
    return this.eventsService.listByTrip(user, tripId);
  }
}
