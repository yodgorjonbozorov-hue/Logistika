import Anthropic from '@anthropic-ai/sdk';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import { AI_MAX_RETRIES, AI_REQUEST_TIMEOUT_MS, estimateCostUsd } from './ai.constants';

export interface AiCallResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/**
 * Thin wrapper around the Anthropic SDK. Every call goes through here so the
 * timeout/retry policy, model selection and cost accounting live in one place
 * — and so tests can mock the network edge (TZ §8.12.5: AI failures must
 * never block the manual flow; callers surface AI_UNAVAILABLE and move on).
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly client: Anthropic | null;
  readonly ocrModel: string;
  readonly chatModel: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey
      ? new Anthropic({ apiKey, timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES })
      : null;
    this.ocrModel = config.get<string>('AI_MODEL_OCR') ?? 'claude-haiku-4-5';
    this.chatModel = config.get<string>('AI_MODEL_CHAT') ?? 'claude-sonnet-5';
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Vision call: one image + an extraction prompt (AI-2 OCR). */
  async vision(
    prompt: string,
    imageBase64: string,
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
    model = this.ocrModel,
  ): Promise<AiCallResult> {
    if (!this.client) throw new AppException('AI_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    const startedAt = Date.now();
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });
      return this.toResult(response, startedAt);
    } catch (error) {
      this.logger.error(`AI vision call failed: ${error instanceof Error ? error.message : error}`);
      throw new AppException('AI_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private toResult(response: Anthropic.Message, startedAt: number): AiCallResult {
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return {
      text,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: estimateCostUsd(
        response.model,
        response.usage.input_tokens,
        response.usage.output_tokens,
      ),
      latencyMs: Date.now() - startedAt,
    };
  }
}
