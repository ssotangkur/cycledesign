import { QwenProvider } from './qwen.js';
import { MistralProvider } from './mistral.js';
import { MockProvider } from './mock.js';
import { IProvider } from '../types.js';
import { getProviderConfig } from '../../trpc/routers/providers.js';

export type LLMProvider = QwenProvider | MistralProvider | MockProvider;

let cachedProvider: IProvider | null = null;

export function getLLMProvider(): IProvider {
  const config = getProviderConfig();

  // If mock provider is enabled and selected, use it
  if (process.env.ENABLE_MOCK_PROVIDER === 'true' && config.provider === 'mock') {
    if (!cachedProvider || cachedProvider.name !== 'mock') {
      cachedProvider = new MockProvider();
    }
    return cachedProvider;
  }

  if (cachedProvider && cachedProvider.name === config.provider) {
    return cachedProvider;
  }

  if (config.provider === 'mistral') {
    cachedProvider = new MistralProvider();
    return cachedProvider;
  }

  cachedProvider = new QwenProvider();
  return cachedProvider;
}
