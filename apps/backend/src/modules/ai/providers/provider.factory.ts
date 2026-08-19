/**
 * Which provider a deployment runs is a configuration decision, not a code one.
 *
 *   AI_PROVIDER=mock       (default) deterministic answers, no key, no network
 *   AI_PROVIDER=anthropic  Claude, via AI_API_KEY
 *
 * The factory falls back to the mock rather than throwing when a configured
 * provider turns out to be unusable: an assistant that answers with correct
 * figures in plainer language is a far better failure mode than an endpoint
 * that 500s, and `env.validation` already refuses to boot a production
 * deployment that selected a provider without giving it a key.
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AnthropicAiProvider } from './anthropic.provider';
import { MockAiProvider } from './mock.provider';
import type { AiProvider } from './ai-provider';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export function createAiProvider(config: ConfigService): AiProvider {
  const logger = new Logger('AiProviderFactory');
  const name = config.get<string>('AI_PROVIDER', 'mock');
  const mock = new MockAiProvider();

  if (name === 'mock') return mock;

  if (name === 'anthropic') {
    const provider = new AnthropicAiProvider({
      apiKey: config.get<string>('AI_API_KEY', ''),
      model: config.get<string>('AI_MODEL', 'claude-opus-5'),
      timeoutMs: config.get<number>('AI_TIMEOUT_MS', 15_000),
    });
    if (provider.isAvailable()) {
      logger.log(`AI provider: anthropic (${config.get<string>('AI_MODEL', 'claude-opus-5')})`);
      return provider;
    }
    logger.warn('AI_PROVIDER=anthropic but no AI_API_KEY — falling back to deterministic answers');
    return mock;
  }

  logger.warn(`Unknown AI_PROVIDER "${name}" — falling back to deterministic answers`);
  return mock;
}
