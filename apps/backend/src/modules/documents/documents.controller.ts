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
  CreateDocumentDto,
  ExpiringDto,
  ListDocumentsDto,
  UpdateDocumentDto,
} from './dto/document.dto';
import { DocumentsService } from './documents.service';

@Controller('documents')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListDocumentsDto) {
    const { data, total } = await this.documentsService.list(user, filter);
    return paginated(data, filter, total);
  }

  /** Muddati yaqin/o'tgan hujjatlar (15/7/1 eslatma manbasi). */
  @Get('expiring')
  expiring(@CurrentUser() user: CurrentUserPayload, @Query() query: ExpiringDto) {
    return this.documentsService.expiring(user, query.days);
  }

  @Get(':id')
  getById(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.getById(user, id);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateDocumentDto) {
    return this.documentsService.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documentsService.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.remove(user, id);
  }
}
