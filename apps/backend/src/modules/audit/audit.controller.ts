import { Controller, Get, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { paginated } from '../../common/dto/pagination.dto';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit.dto';

/**
 * Reading the trail. Restricted to OWNER: the log contains every change anyone
 * made, including salary and balance figures, so it is not a listing for the
 * whole office.
 */
@Controller('audit-logs')
@Roles(UserRole.OWNER, UserRole.SUPERADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListAuditLogsDto) {
    const { data, total } = await this.auditService.list(user, filter);
    return paginated(data, filter, total);
  }
}
