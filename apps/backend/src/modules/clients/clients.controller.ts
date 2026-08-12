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
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

@Controller('clients')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() pagination: PaginationDto) {
    const { data, total } = await this.clientsService.list(user, pagination);
    return paginated(data, pagination, total);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateClientDto) {
    return this.clientsService.create(user, dto);
  }

  /** W-7 qarzdorlar ro'yxati — declared before ':id' so the literal path wins. */
  @Get('receivables')
  receivables(@CurrentUser() user: CurrentUserPayload) {
    return this.clientsService.receivables(user);
  }

  @Get(':id')
  getById(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.getById(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER)
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.remove(user, id);
  }
}
