import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto, paginated } from '../../common/dto/pagination.dto';
import { CompaniesService } from './companies.service';
import { AdminCreateCompanyDto, AdminUpdateCompanyDto } from './dto/admin-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Controller('company')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  /**
   * Office roles only (L-1). This returns the INN, the address, the tariff plan
   * and the subscription — none of which a driver needs, and all of which a
   * driver used to be able to read.
   */
  @Get()
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
  getOwn(@CurrentUser() user: CurrentUserPayload) {
    return this.companiesService.getOwn(user.companyId);
  }

  @Patch()
  @Roles(UserRole.OWNER)
  updateOwn(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.updateOwn(user.companyId, user.userId, dto);
  }
}

@Controller('admin/companies')
@Roles(UserRole.SUPERADMIN)
export class AdminCompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  async list(@Query() pagination: PaginationDto) {
    const { data, total } = await this.companiesService.adminList(pagination);
    return paginated(data, pagination, total);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: AdminCreateCompanyDto) {
    return this.companiesService.adminCreate(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateCompanyDto,
  ) {
    return this.companiesService.adminUpdate(user.userId, id, dto);
  }
}
