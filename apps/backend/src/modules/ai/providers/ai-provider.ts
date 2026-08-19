/**
 * The provider seam.
 *
 * Everything above this interface — intent detection, the analytics facade, the
 * fact sheet, verification, the deterministic answer — works without a provider
 * at all. A provider only ever turns a fact sheet into a sentence, which is why
 * swapping one for another (or losing one entirely) cannot change a number.
 */

export interface AiCompletionRequest {
  /** Instructions. Never contains company data. */
  system: string;
  /** The user's question plus the rendered fact sheet. */
  user: string;
  /** Hard ceiling on the reply; enforced again by the caller. */
  maxTokens: number;
  /** Abort signal wired to the configured timeout. */
  signal: AbortSignal;
}

export interface AiCompletion {
  text: string;
  /** Provider identifier for the audit log — `mock`, `anthropic`, … */
  provider: string;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  /**
   * True when this provider writes nothing of its own — it hands the
   * deterministic draft straight back. The answer is then labelled
   * `template`, because telling a user "an AI wrote this" about text the
   * composer produced is the same kind of untruth the fact verifier exists
   * to prevent.
   */
  readonly deterministic: boolean;
  /** True when the provider is configured well enough to be called at all. */
  isAvailable(): boolean;
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
}

/** Thrown for any provider failure; the caller falls back to the template answer. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'unavailable' | 'refused' | 'failed',
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
