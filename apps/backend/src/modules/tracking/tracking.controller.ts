import {
  BadRequestException,
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
import { PositionBatchDto } from './dto/position.dto';
import { TrackingService } from './tracking.service';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('positions')
  @Roles(UserRole.DRIVER)
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
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (
      !fromDate ||
      Number.isNaN(fromDate.getTime()) ||
      !toDate ||
      Number.isNaN(toDate.getTime())
    ) {
      throw new BadRequestException(['from and to must be valid ISO dates']);
    }
    return this.trackingService.history(user, vehicleId, fromDate, toDate);
  }
}
