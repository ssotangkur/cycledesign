import { QwenProvider } from './providers/qwen';
import { MistralProvider } from './providers/mistral';
import { getProviderConfig } from '../routes/providers';

export type LLMProvider = QwenProvider | MistralProvider;

let cachedProvider: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  const config = getProviderConfig();
  
  if (cachedProvider && cachedProvider instanceof MistralProvider && config.provider === 'mistral') {
    return cachedProvider;
  }
  
  if (config.provider === 'mistral') {
    cachedProvider = new MistralProvider();
    return cachedProvider;
  }
  
  cachedProvider = new QwenProvider();
  return cachedProvider;
}
