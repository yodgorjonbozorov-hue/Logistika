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
import { CreateRouteDto, ListRoutesDto, UpdateRouteDto } from './dto/route.dto';
import { RoutesService } from './routes.service';

@Controller('routes')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() query: ListRoutesDto) {
    const { data, total } = await this.routesService.list(user, query);
    return paginated(data, query, total);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateRouteDto) {
    return this.routesService.create(user, dto);
  }

  @Get(':id')
  getById(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.routesService.getById(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.routesService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER)
  deactivate(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.routesService.deactivate(user, id);
  }
}
