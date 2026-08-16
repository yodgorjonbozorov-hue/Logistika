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
  /** Everything the model is allowed to call. It must call one of them. */
  tools: AiToolSpec[];
  /** Name of the tool it has to pick; omitted means "whichever fits". */
  forceTool?: string;
  maxTokens: number;
}

export interface AiRawResult {
  /** Which tool the model chose — the whole answer in AI-3's first step. */
  toolName: string;
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
 * Answers always come back through a tool call rather than free text: the model
 * then has to produce an object of our schema, and there is no prose to strip or
 * a half-written JSON to repair. With several tools on offer the choice itself
 * is the answer — that is exactly how AI-3 stays away from SQL (TZ §8.4).
 * Retries and the timeout are handled by the SDK; anything left over surfaces as
 * AI_UNAVAILABLE so the caller can fall back to the manual flow (§8.12 rule 5).
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
        tools: prompt.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.schema as Anthropic.Tool['input_schema'],
        })),
        tool_choice: prompt.forceTool ? { type: 'tool', name: prompt.forceTool } : { type: 'any' },
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
      toolName: block.name,
      json: block.input,
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
    };
  }
}
