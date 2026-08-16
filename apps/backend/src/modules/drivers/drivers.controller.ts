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
import { CreateDriverDto, UpdateDriverDto } from './dto/driver.dto';
import { DriversService } from './drivers.service';
import { RatingService } from './rating.service';

@Controller('drivers')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class DriversController {
  constructor(
    private readonly driversService: DriversService,
    private readonly ratingService: RatingService,
  ) {}

  /** W-6 rating: lateness, fuel deviation and breakdowns, with the inputs shown. */
  @Get('ratings')
  ratings(@CurrentUser() user: CurrentUserPayload) {
    return this.ratingService.ratings(user);
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() pagination: PaginationDto) {
    const { data, total } = await this.driversService.list(user, pagination);
    return paginated(data, pagination, total);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateDriverDto) {
    return this.driversService.create(user, dto);
  }

  @Get(':id')
  getById(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.driversService.getById(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverDto,
  ) {
    return this.driversService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER)
  deactivate(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.driversService.deactivate(user, id);
  }
}
