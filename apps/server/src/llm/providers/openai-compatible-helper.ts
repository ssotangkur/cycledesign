import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import type { LanguageModel } from 'ai';

// Pinned call shape against @ai-sdk/openai-compatible v2 (LanguageModelV3,
// same generation as @ai-sdk/mistral v3 — fits ai v6's ToolLoopAgent):
// createOpenAICompatible({ baseURL, name, apiKey, headers }) returns a provider
// whose .chatModel(modelId) yields a LanguageModel. Headers attach at creation
// (Authorization: Bearer <apiKey> is added automatically from apiKey).
// NOTE: v3 of this package speaks the LanguageModelV4 spec, which ai@6.0.97's
// ToolLoopAgent does not accept (its LanguageModel union is V2 | V3 only), so
// v2 is pinned deliberately. Re-verify if ai or the provider majors are bumped.
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const OPENROUTER_APP_REFERER = 'https://github.com/ssotangkur/cycledesign';
const OPENROUTER_APP_TITLE = 'CycleDesign';

export interface GatewayModelOptions {
  baseURL?: string;
  apiKey: string;
  model: string;
  // Static headers merged over the OpenRouter app defaults below.
  // Callers that pass neither `headers` nor `dynamicHeaders` (OpenRouter
  // Free today) get byte-identical behavior to before.
  headers?: Record<string, string>;
  // Per-HTTP-request headers, evaluated fresh on every outgoing fetch.
  // Needed for Zen's `x-opencode-session` / `x-opencode-request` IDs: the
  // ToolLoopAgent caches the model instance, so creation-time IDs would
  // freeze forever. Implemented via the supported `fetch` middleware in
  // `createOpenAICompatible` settings. Never log keys/headers.
  dynamicHeaders?: () => Record<string, string | undefined>;
}

// Wrap global fetch so each outgoing HTTP request carries fresh dynamic
// headers. Handles both string-URL and Request inputs; skips undefined
// values so static creation-time headers are never clobbered. Exported for
// the header-freshness probe (two successive calls must carry different IDs).
export function withDynamicHeaders(
  dynamicHeaders: () => Record<string, string | undefined>,
): FetchFunction {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const extra = dynamicHeaders();
    const apply = (headers: Headers): Headers => {
      for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined) headers.set(key, value);
      }
      return headers;
    };
    if (input instanceof Request) {
      const request = new Request(input, { headers: apply(new Headers(input.headers)) });
      return globalThis.fetch(request, init);
    }
    return globalThis.fetch(input, { ...init, headers: apply(new Headers(init?.headers)) });
  }) as FetchFunction;
}

// Shared OpenAI-compatible gateway factory. OpenRouterFreeProvider always uses
// the OPENROUTER_BASE_URL default; baseURL stays a param for #85 (zen-free)
// reuse. Never logs the API key.
export function createGatewayModel(options: GatewayModelOptions): LanguageModel {
  const { baseURL = OPENROUTER_BASE_URL, apiKey, model, headers, dynamicHeaders } = options;
  const provider = createOpenAICompatible({
    baseURL,
    name: 'openrouter',
    apiKey,
    headers: {
      'HTTP-Referer': OPENROUTER_APP_REFERER,
      'X-Title': OPENROUTER_APP_TITLE,
      ...headers,
    },
    ...(dynamicHeaders ? { fetch: withDynamicHeaders(dynamicHeaders) } : {}),
  });
  return provider.chatModel(model);
}
