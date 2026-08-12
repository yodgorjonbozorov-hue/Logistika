import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AnalyzeReceiptDto, ConfirmOcrDto } from './dto/ocr.dto';
import { OcrService } from './ocr.service';

@Controller('ai')
@Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER)
export class AiController {
  constructor(private readonly ocrService: OcrService) {}

  /** AI-2: chek fotosi → strukturalangan taklif + avto-tekshiruvlar (TZ §8.3). */
  @Post('ocr')
  @HttpCode(HttpStatus.OK)
  analyze(@CurrentUser() user: CurrentUserPayload, @Body() dto: AnalyzeReceiptDto) {
    return this.ocrService.analyze(user, dto);
  }

  /** Odam tasdiqlaydi — shundan keyingina bazaga yozuv tushadi (TZ §8.12.1). */
  @Post('ocr/:id/confirm')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
  @HttpCode(HttpStatus.CREATED)
  confirm(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmOcrDto,
  ) {
    return this.ocrService.confirm(user, id, dto);
  }

  /** Oylik AI sarfi va limit (TZ §8.11). */
  @Get('usage')
  @Roles(UserRole.OWNER, UserRole.ACCOUNTANT)
  usage(@CurrentUser() user: CurrentUserPayload) {
    return this.ocrService.usage(user);
  }
}
