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

export const OPENROUTER_APP_REFERER = 'https://github.com/ssotangkur/cycledesign';
export const OPENROUTER_APP_TITLE = 'CycleDesign';

export interface GatewayModelOptions {
  baseURL?: string;
  name?: string;
  apiKey?: string;
  model: string;
  // Static headers passed through as-is — no defaults injected, so local
  // no-auth servers receive no OpenRouter headers. Callers needing
  // attribution (OpenRouter, Zen) pass them explicitly.
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

// Shared OpenAI-compatible gateway factory (also reused by the local provider
// for #104 and zen-free for #85). baseURL defaults to OpenRouter; callers that
// need attribution headers (OpenRouter, Zen) pass them explicitly — no default
// headers are injected, so local no-auth servers receive no OpenRouter
// headers and no Authorization header when apiKey is omitted. Never logs keys.
export function createGatewayModel(options: GatewayModelOptions): LanguageModel {
  const {
    baseURL = OPENROUTER_BASE_URL,
    name = 'openrouter',
    apiKey,
    model,
    headers,
    dynamicHeaders,
  } = options;
  const provider = createOpenAICompatible({
    baseURL,
    name,
    ...(apiKey ? { apiKey } : {}),
    ...(headers ? { headers } : {}),
    ...(dynamicHeaders ? { fetch: withDynamicHeaders(dynamicHeaders) } : {}),
  });
  return provider.chatModel(model);
}
