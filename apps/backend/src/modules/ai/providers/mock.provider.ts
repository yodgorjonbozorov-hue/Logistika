/**
 * The default provider.
 *
 * It is not a stub for tests — it is what a deployment with no AI subscription
 * runs in production, and it is why the assistant is a real feature rather than
 * a feature flag. It returns the deterministic answer the composer already
 * built, so the user gets correct figures and a readable sentence; what they do
 * not get is the fluency and the follow-up reasoning of a real model.
 *
 * It also makes the whole pipeline testable end to end without a network call,
 * an API key, or a bill.
 */
import { Injectable } from '@nestjs/common';
import type { AiCompletion, AiCompletionRequest, AiProvider } from './ai-provider';

/** The composer's answer is handed to the provider inside this marker. */
export const DETERMINISTIC_ANSWER_MARKER = '<<DETERMINISTIC_ANSWER>>';

@Injectable()
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  readonly deterministic = true;

  isAvailable(): boolean {
    return true;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const start = request.user.indexOf(DETERMINISTIC_ANSWER_MARKER);
    const text =
      start === -1 ? '' : request.user.slice(start + DETERMINISTIC_ANSWER_MARKER.length).trim();
    return { text, provider: this.name, model: 'deterministic' };
  }
}
