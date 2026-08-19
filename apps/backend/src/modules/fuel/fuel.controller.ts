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
  CreateFuelLogDto,
  FuelControlDto,
  ListFuelLogsDto,
  UpdateFuelLogDto,
} from './dto/fuel.dto';
import { FuelService } from './fuel.service';

@Controller('fuel')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class FuelController {
  constructor(private readonly fuelService: FuelService) {}

  /** W-8 control table — the norm-versus-reality comparison. */
  @Get('control')
  control(@CurrentUser() user: CurrentUserPayload, @Query() range: FuelControlDto) {
    return this.fuelService.control(user, range);
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListFuelLogsDto) {
    const { data, total } = await this.fuelService.list(user, filter);
    return paginated(data, filter, total);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateFuelLogDto) {
    return this.fuelService.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFuelLogDto,
  ) {
    return this.fuelService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.fuelService.remove(user, id);
  }
}
