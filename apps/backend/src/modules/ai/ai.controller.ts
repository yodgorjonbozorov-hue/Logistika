import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AiService } from './ai.service';
import { ConfirmAiRequestDto, ReadDocumentDto } from './dto/ocr.dto';
import { OcrService } from './ocr.service';

/**
 * AI endpoints (TZ §8). None of them writes a business record: `ocr` returns a
 * proposal, `confirm` only records that a person accepted it. Creating the fuel
 * log or the expense stays with the ordinary /fuel and /expenses endpoints.
 */
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly ocr: OcrService,
  ) {}

  /** Whether AI is usable at all — the UI hides the buttons when it is not. */
  @Get('status')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER)
  async status(@CurrentUser() user: CurrentUserPayload) {
    const usage = await this.ai.usage(user.companyId as string);
    return {
      available: this.ai.available && !usage.exhausted,
      configured: this.ai.available,
      month: usage.month,
      usedMicroUsd: usage.usedMicroUsd,
      limitMicroUsd: usage.limitMicroUsd,
    };
  }

  /** AI-2: read a photographed receipt or document into a proposal. */
  @Post('ocr')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER)
  readDocument(@CurrentUser() user: CurrentUserPayload, @Body() dto: ReadDocumentDto) {
    return this.ocr.readDocument(user, dto);
  }

  /** Records that a person accepted the proposal, with any corrections. */
  @Patch('requests/:id/confirm')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT, UserRole.DRIVER)
  confirm(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmAiRequestDto,
  ) {
    return this.ai.confirm(user.companyId as string, id, user.userId, dto.correctedData);
  }
}
