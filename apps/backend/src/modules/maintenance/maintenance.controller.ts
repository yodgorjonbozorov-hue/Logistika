import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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

  /** W-5/W-10: vehicles at or past their next service. */
  @Get('due')
  due(@CurrentUser() user: CurrentUserPayload) {
    return this.maintenanceService.due(user);
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListMaintenanceDto) {
    const { data, total } = await this.maintenanceService.list(user, filter);
    return paginated(data, filter, total);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateMaintenanceDto) {
    return this.maintenanceService.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMaintenanceDto,
  ) {
    return this.maintenanceService.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.maintenanceService.remove(user, id);
  }
}
