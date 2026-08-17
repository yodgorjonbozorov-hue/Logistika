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
import { LedgerService } from '../ledger/ledger.service';
import { ListLedgerDto } from '../ledger/dto/ledger.dto';
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

@Controller('clients')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly ledgerService: LedgerService,
  ) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() pagination: PaginationDto) {
    const { data, total } = await this.clientsService.list(user, pagination);
    return paginated(data, pagination, total);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateClientDto) {
    return this.clientsService.create(user, dto);
  }

  @Get(':id')
  getById(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.clientsService.getById(user, id);
  }

  /** Every movement on this client's account, newest first. */
  @Get(':id/ledger')
  async ledger(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filter: ListLedgerDto,
  ) {
    const { data, total } = await this.ledgerService.list(user, id, filter);
    return paginated(data, filter, total);
  }

  /** What the client owes right now, and how much of it is late. */
  @Get(':id/balance')
  balance(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.ledgerService.balanceOf(user, id);
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
