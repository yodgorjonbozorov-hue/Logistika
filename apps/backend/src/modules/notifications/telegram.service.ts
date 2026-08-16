import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const API_BASE = 'https://api.telegram.org';
const SEND_TIMEOUT_MS = 10_000;

/**
 * The boss's channel (TZ §7): owners live in Telegram, so the daily digest and
 * the sharpest alerts go there.
 *
 * Sending never throws. A message that does not arrive is a missed convenience,
 * not a failed job — the same figures are on the dashboard either way, and a
 * cron that dies on one unreachable chat would skip every company after it.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  /** Returns whether the message actually went out. */
  async send(chatId: string, text: string): Promise<boolean> {
    if (!this.configured) return false;

    try {
      const response = await fetch(`${API_BASE}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          // Plain text: a digest carries plate numbers and sums, and one stray
          // underscore in a company name would break Markdown parsing.
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Telegram refused a message to ${chatId}: HTTP ${response.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Telegram unreachable for ${chatId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
