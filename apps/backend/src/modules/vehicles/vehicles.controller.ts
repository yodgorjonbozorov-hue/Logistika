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
import { PaginationDto, paginated } from '../../common/dto/pagination.dto';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';
import { VehiclesService } from './vehicles.service';

@Controller('vehicles')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() pagination: PaginationDto) {
    const { data, total } = await this.vehiclesService.list(user, pagination);
    return paginated(data, pagination, total);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(user, dto);
  }

  @Get(':id')
  getById(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehiclesService.getById(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehiclesService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER)
  deactivate(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehiclesService.deactivate(user, id);
  }
}
