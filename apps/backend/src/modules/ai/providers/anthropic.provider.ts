/**
 * Claude, via the official Anthropic SDK.
 *
 * The API key lives in the backend environment and is read here only. It is
 * never sent to a browser, never part of a response, and the web app has no
 * route to the provider at all — every question goes to `POST /ai/chat` on this
 * API, which is what makes the key, the rate limit and the tenant scope
 * enforceable in the first place.
 *
 * Deliberately NOT passed:
 *  - `temperature` and the other sampling parameters. They are rejected by the
 *    current Claude models, and a request carrying one fails with a 400.
 *  - any tool definition. The model has no tools here; it receives a finished
 *    fact sheet and writes prose about it. That is the whole contract.
 */
import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiProviderError,
  type AiCompletion,
  type AiCompletionRequest,
  type AiProvider,
} from './ai-provider';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** Client-side ceiling; the request also carries an AbortSignal. */
  timeoutMs: number;
}

@Injectable()
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly deterministic = false;
  private readonly logger = new Logger(AnthropicAiProvider.name);
  private readonly client: Anthropic | null;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client = options.apiKey
      ? new Anthropic({ apiKey: options.apiKey, maxRetries: 1, timeout: options.timeoutMs })
      : null;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    if (!this.client) throw new AiProviderError('No API key configured', 'unavailable');

    try {
      const response = await this.client.messages.create(
        {
          model: this.options.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        },
        { signal: request.signal, timeout: this.options.timeoutMs },
      );

      // A safety decline is not an application error — the caller falls back to
      // the deterministic answer, which is the same figures without the prose.
      //
      // Widened to `string`: `refusal` is a newer stop reason than the SDK
      // version pinned here, so its union does not list it, but the API returns
      // it and a build that ignored it would treat a decline as an empty answer.
      const stopReason: string | null = response.stop_reason;
      if (stopReason === 'refusal') {
        throw new AiProviderError('The model declined to answer', 'refused');
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      // Thinking can consume the whole budget and leave no prose behind; that
      // is a failed completion, not an empty answer to show the user.
      if (!text) throw new AiProviderError('The model returned no text', 'failed');

      return { text, provider: this.name, model: response.model };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof Anthropic.APIConnectionTimeoutError || isAbort(error)) {
        throw new AiProviderError('The model timed out', 'timeout');
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new AiProviderError('The provider rate-limited the request', 'unavailable');
      }
      if (error instanceof Anthropic.AuthenticationError) {
        // Worth a loud log: the deployment is misconfigured, and every question
        // will silently fall back until somebody fixes the key.
        this.logger.error('Anthropic rejected the API key — check AI_API_KEY');
        throw new AiProviderError('The provider rejected the credentials', 'unavailable');
      }
      this.logger.warn(
        `Anthropic call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new AiProviderError('The provider call failed', 'failed');
    }
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
