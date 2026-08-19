import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { UserRole, type CurrentUserPayload } from 'shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ThrottleAi } from '../../common/throttle/throttle';
import { I18nService } from '../../i18n/i18n.service';
import { AiService } from './ai.service';
import { AskDto } from './dto/ai.dto';

/**
 * The assistant's HTTP surface. Two endpoints, both read-only.
 *
 * `@Roles` excludes DRIVER for the same reason the finance endpoints do: these
 * answers ARE the company's finances, in a sentence. The guard is what enforces
 * that — the web app also hides the page, but that is only UX.
 */
@Controller('ai')
@Roles(UserRole.OWNER, UserRole.ACCOUNTANT, UserRole.LOGIST)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly i18n: I18nService,
  ) {}

  /** Ask a question about this company's own data. */
  @Post('chat')
  @ThrottleAi()
  ask(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: AskDto,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    const locale = dto.locale ?? this.i18n.resolveLocale(acceptLanguage);
    return this.ai.ask(user, dto.question, locale);
  }

  /**
   * Dashboard insights. Deterministic and provider-free, so it stays cheap
   * enough to load on every dashboard render and keeps working when the AI
   * provider does not.
   */
  @Get('insights')
  insights(@CurrentUser() user: CurrentUserPayload) {
    return this.ai.insights(user);
  }

  /** What the UI needs to decide whether to advertise the assistant. */
  @Get('status')
  status() {
    return { provider: this.ai.providerName, available: this.ai.providerName !== 'disabled' };
  }
}
