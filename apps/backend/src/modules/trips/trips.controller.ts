import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { paginated } from '../../common/dto/pagination.dto';
import {
  AssignTripDto,
  CompleteTripDto,
  CreateTripDto,
  ListTripsDto,
  StartTripDto,
  UpdateTripDto,
} from './dto/trip.dto';
import { TripsService } from './trips.service';

@Controller('trips')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListTripsDto) {
    const { data, total } = await this.tripsService.list(user, filter);
    return paginated(data, filter, total);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  @Idempotent()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateTripDto) {
    return this.tripsService.create(user, dto);
  }

  @Get('my')
  @Roles(UserRole.DRIVER)
  listMine(@CurrentUser() user: CurrentUserPayload) {
    return this.tripsService.listMine(user);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER)
  getById(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.tripsService.getById(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTripDto,
  ) {
    return this.tripsService.update(user, id, dto);
  }

  @Post(':id/assign')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  @HttpCode(HttpStatus.OK)
  assign(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTripDto,
  ) {
    return this.tripsService.assign(user, id, dto);
  }

  @Post(':id/start')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  @HttpCode(HttpStatus.OK)
  start(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartTripDto,
  ) {
    return this.tripsService.start(user, id, dto);
  }

  @Post(':id/complete')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteTripDto,
  ) {
    return this.tripsService.complete(user, id, dto);
  }

  @Post(':id/cancel')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.tripsService.cancel(user, id);
  }
}
