import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SMS gateway wrapper. Without SMS_PROVIDER_URL configured (dev) the code is
 * only logged; a provider failure must never crash the login flow — the user
 * simply requests a new code.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async send(phone: string, text: string): Promise<void> {
    const providerUrl = this.config.get<string>('SMS_PROVIDER_URL');
    if (!providerUrl) {
      this.logger.log(`[DEV SMS] ${phone}: ${text}`);
      return;
    }
    try {
      const response = await fetch(providerUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.get<string>('SMS_PROVIDER_TOKEN') ?? ''}`,
        },
        body: JSON.stringify({ phone, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        this.logger.error(`SMS provider returned ${response.status} for ${phone}`);
      }
    } catch (error) {
      this.logger.error(
        `SMS send failed for ${phone}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
