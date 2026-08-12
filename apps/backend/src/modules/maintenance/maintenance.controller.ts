import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { paginated } from '../../common/dto/pagination.dto';
import {
  CreateMaintenanceDto,
  ListMaintenanceDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@Controller('maintenance')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListMaintenanceDto) {
    const { data, total } = await this.maintenanceService.list(user, filter);
    return paginated(data, filter, total);
  }

  /** TO vaqti kelganlar (W-5 karta, W-10 ogohlantirish manbasi). */
  @Get('upcoming')
  upcoming(@CurrentUser() user: CurrentUserPayload) {
    return this.maintenanceService.upcoming(user);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateMaintenanceDto) {
    return this.maintenanceService.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMaintenanceDto,
  ) {
    return this.maintenanceService.update(user, id, dto);
  }
}
