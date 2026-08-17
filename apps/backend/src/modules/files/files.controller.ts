import {
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ANY_ROLE, Roles } from '../../common/decorators/roles.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { FilesService } from './files.service';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Drivers photograph receipts, so uploading is open to every signed-in role;
// reading is bounded by the tenant-scoped lookup in the service.
@Controller('files')
@Roles(...ANY_ROLE)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(@CurrentUser() user: CurrentUserPayload, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, undefined, [
        'file is required',
      ]);
    }
    return this.filesService.upload(user, file);
  }

  @Get(':id/url')
  getUrl(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.filesService.getSignedUrl(user, id);
  }
}
