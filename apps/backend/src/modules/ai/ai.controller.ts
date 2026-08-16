import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AiService } from './ai.service';
import { AnomalyService } from './anomaly.service';
import { ChatService } from './chat.service';
import {
  AskDto,
  ConfirmAiRequestDto,
  ListInsightsDto,
  ReadDocumentDto,
  SetInsightStatusDto,
} from './dto/ai.dto';
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
    private readonly anomaly: AnomalyService,
    private readonly chat: ChatService,
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

  /** AI-4: anomalies the nightly scan found (W-10 «AI topgan»). */
  @Get('insights')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
  insights(@CurrentUser() user: CurrentUserPayload, @Query() filter: ListInsightsDto) {
    return this.anomaly.list(user.companyId as string, filter.status);
  }

  /**
   * The boss's verdict on a finding. FALSE_POSITIVE is how the detector's own
   * quality gets measured (TZ §8.10).
   */
  @Patch('insights/:id/status')
  @Roles(UserRole.OWNER, UserRole.LOGIST)
  setInsightStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetInsightStatusDto,
  ) {
    return this.anomaly.setStatus(user.companyId as string, id, dto.status, user.userId);
  }

  /**
   * AI-3: a question in plain language. The model picks one prepared query and
   * words the result — it never sees the database and never writes SQL (TZ §8.4).
   */
  @Post('chat')
  @Roles(UserRole.OWNER, UserRole.LOGIST, UserRole.ACCOUNTANT)
  ask(@CurrentUser() user: CurrentUserPayload, @Body() dto: AskDto) {
    return this.chat.ask(user, dto.question);
  }
}
