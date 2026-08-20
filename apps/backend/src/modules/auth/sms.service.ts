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
      // Printing the code is a development convenience and an account-takeover
      // primitive in production: a login code in a log file is a valid
      // credential for anyone who can read logs, which is a much larger group
      // than the people who can read the driver's phone. In production the
      // misconfiguration is reported instead — loudly, because driver login is
      // now broken and somebody has to notice.
      if (this.config.get<string>('NODE_ENV') === 'production') {
        this.logger.error('SMS_PROVIDER_URL is not configured — driver login codes cannot be sent');
        return;
      }
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
        this.logger.error(`SMS provider returned ${response.status}`);
      }
    } catch (error) {
      // The phone number is left out on purpose: it identifies a person, the
      // log is kept for months, and it adds nothing to diagnosing a gateway
      // failure that the request id does not already give.
      this.logger.error(
        `SMS send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
