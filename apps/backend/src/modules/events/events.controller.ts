import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { EventBatchDto } from './dto/event.dto';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post('batch')
  @Roles(UserRole.DRIVER)
  @HttpCode(HttpStatus.OK)
  ingestBatch(@CurrentUser() user: CurrentUserPayload, @Body() dto: EventBatchDto) {
    return this.eventsService.ingestBatch(user, dto);
  }

  /** Dashboard feed — must be declared before the `tripId` list route. */
  @Get('recent')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
  listRecent(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.eventsService.listRecent(user, limit);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER)
  listByTrip(@CurrentUser() user: CurrentUserPayload, @Query('tripId') tripId: string) {
    return this.eventsService.listByTrip(user, tripId);
  }
}
