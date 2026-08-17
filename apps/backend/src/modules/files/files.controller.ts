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
import { Throttle, seconds } from '@nestjs/throttler';
import type { CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { THROTTLERS } from '../../common/throttling/throttling.module';
import { FilesService } from './files.service';

/**
 * Multer buffers the whole upload in memory, so this cap is also a RAM budget:
 * 15 MB × concurrent uploads was enough to push the process over on a small
 * VPS. Phone photos land well under 8 MB, and the rate limiter bounds how many
 * can be in flight per user.
 */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Throttle({ [THROTTLERS.user]: { limit: 30, ttl: seconds(60) } })
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
