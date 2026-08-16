import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';

const TIMEOUT_MS = 60_000;

export interface TranscribeInput {
  audio: Buffer;
  mimeType: string;
  /** Hint for the recogniser; drivers speak Uzbek or Russian (TZ §8.2). */
  language?: string;
}

/**
 * Speech to text for AI-1 (TZ §8.2).
 *
 * Abstract so the voice flow can be tested without a network call, and so the
 * recogniser stays swappable — the endpoint is configured, not compiled in.
 */
export abstract class TranscribeClient {
  abstract readonly configured: boolean;
  abstract transcribe(input: TranscribeInput): Promise<string>;
}

/**
 * Whisper over its usual HTTP shape: multipart POST to /audio/transcriptions,
 * `{ text }` back. Any provider speaking that dialect works, which is why the
 * base URL is an environment variable rather than a constant.
 */
@Injectable()
export class WhisperTranscribeClient extends TranscribeClient {
  private readonly logger = new Logger(WhisperTranscribeClient.name);
  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    super();
    this.url = config.get<string>('WHISPER_API_URL') ?? '';
    this.apiKey = config.get<string>('WHISPER_API_KEY') ?? '';
    this.model = config.get<string>('WHISPER_MODEL') ?? 'whisper-1';
  }

  get configured(): boolean {
    return this.url.length > 0;
  }

  async transcribe(input: TranscribeInput): Promise<string> {
    if (!this.configured) {
      throw new AppException('AI_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), 'note');
    form.append('model', this.model);
    if (input.language) form.append('language', input.language);

    let payload: unknown;
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.error(`Transcription refused: HTTP ${response.status}`);
        throw new AppException('AI_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof AppException) throw error;
      // Logged, never swallowed — the driver falls back to typing.
      this.logger.error(
        `Transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new AppException('AI_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const text = (payload as { text?: unknown })?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new AppException('AI_INVALID_RESPONSE', HttpStatus.BAD_GATEWAY);
    }
    return text.trim();
  }
}
