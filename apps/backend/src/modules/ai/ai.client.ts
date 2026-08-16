import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';

/** JSON-schema shaped tool the model must fill in — our structured output. */
export interface AiToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface AiPrompt {
  model: string;
  system: string;
  messages: MessageParam[];
  tool: AiToolSpec;
  maxTokens: number;
}

export interface AiRawResult {
  /** Raw tool input as the model produced it — still untrusted at this point. */
  json: unknown;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Transport to the model. Abstract so services can be tested without a network
 * call and so a different provider could be dropped in without touching them.
 */
export abstract class AiClient {
  abstract readonly configured: boolean;
  abstract complete(prompt: AiPrompt): Promise<AiRawResult>;
}

/**
 * Anthropic implementation.
 *
 * Answers always come back through a forced tool call rather than free text:
 * the model then has to produce an object of our schema, and there is no prose
 * to strip or a half-written JSON to repair. Retries and the timeout are handled
 * by the SDK; anything left over surfaces as AI_UNAVAILABLE so the caller can
 * fall back to the manual flow (TZ §8.12 rule 5).
 */
@Injectable()
export class AnthropicAiClient extends AiClient {
  private readonly logger = new Logger(AnthropicAiClient.name);
  private readonly client: Anthropic | null;
  readonly configured: boolean;

  constructor(config: ConfigService) {
    super();
    const apiKey = config.get<string>('ANTHROPIC_API_KEY') ?? '';
    this.configured = apiKey.length > 0;
    this.client = this.configured
      ? new Anthropic({
          apiKey,
          timeout: config.get<number>('AI_TIMEOUT_MS') ?? 60_000,
          maxRetries: config.get<number>('AI_MAX_RETRIES') ?? 2,
        })
      : null;
  }

  async complete(prompt: AiPrompt): Promise<AiRawResult> {
    if (!this.client) {
      throw new AppException('AI_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
    }

    let message;
    try {
      message = await this.client.messages.create({
        model: prompt.model,
        max_tokens: prompt.maxTokens,
        system: prompt.system,
        messages: prompt.messages,
        tools: [
          {
            name: prompt.tool.name,
            description: prompt.tool.description,
            input_schema: prompt.tool.schema as Anthropic.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool', name: prompt.tool.name },
      });
    } catch (error) {
      // Logged, never swallowed: the caller decides whether to degrade or fail.
      this.logger.error(`AI call failed (${prompt.model})`, error as Error);
      throw new AppException('AI_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const block = message.content.find((part) => part.type === 'tool_use');
    if (!block) {
      throw new AppException('AI_INVALID_RESPONSE', HttpStatus.BAD_GATEWAY);
    }

    return {
      json: block.input,
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
    };
  }
}
