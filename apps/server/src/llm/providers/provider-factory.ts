import { QwenProvider } from './qwen.js';
import { MistralProvider } from './mistral.js';
import { OpenRouterFreeProvider } from './openrouter-free.js';
import { MockProvider } from './mock.js';
import { IProvider } from '../types.js';
import { getProviderConfig } from '../../trpc/routers/providers.js';
import { BaseProvider } from './base-provider.js';

export type LLMProvider = QwenProvider | MistralProvider | OpenRouterFreeProvider | MockProvider;

let cachedProvider: IProvider | null = null;

export function clearProviderCache(): void {
  if (cachedProvider instanceof BaseProvider) {
    cachedProvider.clearCachedAgent();
  }
  cachedProvider = null;
}

export function getLLMProvider(): IProvider {
  const config = getProviderConfig();

  // If mock provider is enabled and selected, use it
  if (process.env.ENABLE_MOCK_PROVIDER === 'true' && config.provider === 'mock') {
    if (!cachedProvider || cachedProvider.name !== 'mock') {
      cachedProvider = new MockProvider();
      console.log('[ProviderFactory] Using MockProvider (ENABLE_MOCK_PROVIDER=true)');
    }
    return cachedProvider;
  }

  if (cachedProvider && cachedProvider.name === config.provider) {
    return cachedProvider;
  }

  if (config.provider === 'mistral') {
    cachedProvider = new MistralProvider();
    console.log('[ProviderFactory] Using MistralProvider');
    return cachedProvider;
  }

  if (config.provider === 'openrouter-free') {
    cachedProvider = new OpenRouterFreeProvider();
    console.log('[ProviderFactory] Using OpenRouterFreeProvider');
    return cachedProvider;
  }

  cachedProvider = new QwenProvider();
  console.log('[ProviderFactory] Using QwenProvider');
  return cachedProvider;
}
