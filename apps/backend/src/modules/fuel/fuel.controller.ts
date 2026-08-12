import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { paginated } from '../../common/dto/pagination.dto';
import { PeriodDto } from '../../common/dto/period.dto';
import { CreateFuelLogDto, ListFuelDto, UpdateFuelLogDto } from './dto/fuel.dto';
import { FuelService } from './fuel.service';

@Controller('fuel')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class FuelController {
  constructor(private readonly fuelService: FuelService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListFuelDto) {
    const { data, total } = await this.fuelService.list(user, filter);
    return paginated(data, filter, total);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateFuelLogDto) {
    return this.fuelService.create(user, dto);
  }

  /** W-8 nazorat jadvali: probeg, norma, real, farq, zarar. */
  @Get('control')
  control(@CurrentUser() user: CurrentUserPayload, @Query() period: PeriodDto) {
    return this.fuelService.control(user, period.fromDate, period.toDate);
  }

  /** W-8 AZS tahlili. */
  @Get('by-station')
  byStation(@CurrentUser() user: CurrentUserPayload, @Query() period: PeriodDto) {
    return this.fuelService.byStation(user, period.fromDate, period.toDate);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFuelLogDto,
  ) {
    return this.fuelService.update(user, id, dto);
  }
}
