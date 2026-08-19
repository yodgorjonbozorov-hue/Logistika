import {
  Body,
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
import { ThrottleIngest } from '../../common/throttle/throttle';
import { PositionBatchDto, TrackHistoryDto } from './dto/position.dto';
import { TrackingService } from './tracking.service';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('positions')
  @Roles(UserRole.DRIVER)
  @ThrottleIngest()
  @HttpCode(HttpStatus.OK)
  ingestPositions(@CurrentUser() user: CurrentUserPayload, @Body() dto: PositionBatchDto) {
    return this.trackingService.ingestPositions(user, dto);
  }

  @Get('live')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
  live(@CurrentUser() user: CurrentUserPayload) {
    return this.trackingService.live(user);
  }

  @Get('vehicles/:id/history')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
  history(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) vehicleId: string,
    @Query() query: TrackHistoryDto,
  ) {
    return this.trackingService.history(user, vehicleId, query);
  }
}
