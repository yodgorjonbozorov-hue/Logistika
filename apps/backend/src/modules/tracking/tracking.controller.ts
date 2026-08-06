import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
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
}
