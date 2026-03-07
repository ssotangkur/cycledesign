import { QwenProvider } from './qwen.js';
import { MistralProvider } from './mistral.js';
import { IProvider } from '../types.js';
import { getProviderConfig } from '../../trpc/routers/providers.js';

export type LLMProvider = QwenProvider | MistralProvider;

let cachedProvider: IProvider | null = null;

export function getLLMProvider(): IProvider {
  const config = getProviderConfig();

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
