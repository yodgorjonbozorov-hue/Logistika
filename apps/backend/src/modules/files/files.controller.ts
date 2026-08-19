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
import { AppException } from '../../common/exceptions/app.exception';
import { ThrottleUpload } from '../../common/throttle/throttle';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @ThrottleUpload()
  // Limits are configured centrally in FilesModule's MulterModule factory.
  @UseInterceptors(FileInterceptor('file'))
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
