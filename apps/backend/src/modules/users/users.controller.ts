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
import { ThrottleAccount } from '../../common/throttle/throttle';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  async list(@CurrentUser() user: CurrentUserPayload, @Query() pagination: PaginationDto) {
    const { data, total } = await this.usersService.list(user, pagination);
    return paginated(data, pagination, total);
  }

  @Post()
  @Roles(UserRole.OWNER)
  @ThrottleAccount()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateUserDto) {
    return this.usersService.create(user, dto);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  getById(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getById(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER)
  @ThrottleAccount()
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER)
  @ThrottleAccount()
  deactivate(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.deactivate(user, id);
  }
}
