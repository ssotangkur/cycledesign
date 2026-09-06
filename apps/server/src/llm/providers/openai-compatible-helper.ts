import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

// Pinned call shape against @ai-sdk/openai-compatible v3 (AI SDK v6 line):
// createOpenAICompatible({ baseURL, name, apiKey, headers }) returns a provider
// whose .chatModel(modelId) yields a LanguageModel. Headers attach at creation
// (Authorization: Bearer <apiKey> is added automatically from apiKey).
// Re-verify this shape if the v3 major is ever bumped.
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const OPENROUTER_APP_REFERER = 'https://github.com/ssotangkur/cycledesign';
const OPENROUTER_APP_TITLE = 'CycleDesign';

export interface GatewayModelOptions {
  baseURL?: string;
  apiKey: string;
  model: string;
}

// Shared OpenAI-compatible gateway factory. OpenRouterFreeProvider always uses
// the OPENROUTER_BASE_URL default; baseURL stays a param for #85 (zen-free)
// reuse. Never logs the API key.
export function createGatewayModel(options: GatewayModelOptions): LanguageModel {
  const { baseURL = OPENROUTER_BASE_URL, apiKey, model } = options;
  const provider = createOpenAICompatible({
    baseURL,
    name: 'openrouter',
    apiKey,
    headers: {
      'HTTP-Referer': OPENROUTER_APP_REFERER,
      'X-Title': OPENROUTER_APP_TITLE,
    },
  });
  return provider.chatModel(model);
}
