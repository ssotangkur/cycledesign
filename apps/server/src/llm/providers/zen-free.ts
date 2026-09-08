import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { BaseProvider, type AgentConfig } from './base-provider.js';
import { createGatewayModel, withDynamicHeaders } from './openai-compatible-helper.js';
import { FreeUsageLimitError, RateLimitError } from '../errors.js';
import { IProviderConfig, LLMResponse } from '../types.js';

// Zen Free (OpenCode) — Phase 2 free provider with per-model transport dispatch.
// Ports pi-free's `resolveOpenCodeModelApi` table:
// - `gpt-*` -> openai-responses (`/v1/responses`)
// - `claude-*` / `qwen3-*` / `qwen3.*` -> anthropic-messages (`/v1/messages`)
// - `gemini-*` -> google-generative-ai (`/v1/models/...:generateContent`)
// - rest -> openai-completions (`/v1/chat/completions`) via the shared gateway.
//
// Header caveat — headers are the whole Zen trick:
// - Availability rotates (the free set is ~7 models, all "limited time").
// - Free-tier prompts may be retained for training — use accordingly.
// - Limits are unpublished per-model daily quotas; without CLI-faithful
//   headers Zen treats the caller as third-party (~2 req/day freeze), with
//   them the full daily quota applies.
// - Keyless (`apiKey: "none"`) is deliberately NOT supported here: Zen's
//   free tier 401s on any Bearer and the backend header gate could be
//   re-enabled anytime. A key from https://opencode.ai/auth is required.
// - Never log the API key.

export const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
export const ZEN_FREE_DISPLAY_NAME = 'Zen Free (OpenCode)';

// Bare CLI User-Agent. The full `opencode/<version> ai-sdk/...` form is
// produced automatically by each SDK's `withUserAgentSuffix` — never
// hand-roll the suffix (it would double-append).
const ZEN_USER_AGENT = 'opencode/1.18.18';

const CONFIG_DIR = join(process.cwd(), '.cycledesign');
const ZEN_FREE_CONFIG_FILE = join(CONFIG_DIR, 'zen-free.json');

const ZEN_CATALOG_TTL_MS = 60 * 60 * 1000;

// Upper bound for the live catalog probe: listModels() must never hang
// Settings (cold path awaits this), so a stalled connection aborts into the
// normal catch path (stale-serve, or [] with no cache).
const ZEN_CATALOG_TIMEOUT_MS = 10 * 1000;

interface ZenFreeFileConfig {
  apiKey?: string;
  model?: string;
}

export interface ZenFreeResolvedConfig {
  apiKey: string | undefined;
  model: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadFileConfig(): ZenFreeFileConfig {
  try {
    if (existsSync(ZEN_FREE_CONFIG_FILE)) {
      const data = readFileSync(ZEN_FREE_CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load Zen Free config:', error);
  }
  return {};
}

// Single resolution point used by the ctor + static loadConfig()/hasApiKey().
// Precedence: env > file > default (empty — zero hardcodes; the free set
// rotates, so no checked-in default model ID). OPENCODE_API_KEY is the key
// from https://opencode.ai/auth.
export function getZenConfig(): ZenFreeResolvedConfig {
  const file = loadFileConfig();
  return {
    apiKey: process.env.OPENCODE_API_KEY ?? file.apiKey,
    model: process.env.ZEN_FREE_MODEL ?? file.model ?? '',
  };
}

// Fresh CLI-faithful per-HTTP-request IDs. The ToolLoopAgent caches the model
// instance, so these must be generated inside the fetch middleware closure
// (one evaluation per outgoing HTTP request), never at creation time.
export function createZenDynamicHeaders(): Record<string, string> {
  const randomId = (): string => uuidv4().replace(/-/g, '').slice(0, 24);
  return {
    'x-opencode-session': `ses_${randomId()}`,
    'x-opencode-request': `prt_${randomId()}`,
  };
}

export type ZenTransport =
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'openai-completions';

// Per-model transport dispatch (pi-free `resolveOpenCodeModelApi` parity).
// Case-sensitive `startsWith` on the raw full model ID, no vendor-prefix
// stripping. Precedence: `gpt-` > `claude-`/`qwen3-`/`qwen3.` > `gemini-` >
// rest. The `qwen3.` dot-variant is a pi-parity superset preventing silent
// `rest` fallback for `qwen3.5`-style IDs.
export function resolveZenTransport(modelId: string): ZenTransport {
  if (modelId.startsWith('gpt-')) return 'openai-responses';
  if (
    modelId.startsWith('claude-') ||
    modelId.startsWith('qwen3-') ||
    modelId.startsWith('qwen3.')
  ) {
    return 'anthropic-messages';
  }
  if (modelId.startsWith('gemini-')) return 'google-generative-ai';
  return 'openai-completions';
}

// Guard normalizer for the Zen base URL (ZEN_BASE_URL already ends `…/v1`).
// Strips trailing slashes plus any trailing `/chat/completions`, `/responses`,
// or `/messages` suffixes, then ensures the result ends with `…/v1`. Takes
// input so it stays table-testable over varied inputs.
export function normalizeZenBase(input: string): string {
  let base = input.trim().replace(/\/+$/, '');
  const suffixes = ['/chat/completions', '/responses', '/messages'];
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of suffixes) {
      if (base.endsWith(suffix)) {
        base = base.slice(0, -suffix.length).replace(/\/+$/, '');
        stripped = true;
      }
    }
  }
  base = base.replace(/\/+$/, '');
  if (!base.endsWith('/v1')) {
    base = `${base}/v1`;
  }
  return base;
}

function zenStaticHeaders(): Record<string, string> {
  return {
    'x-opencode-client': 'cli',
    'x-opencode-project': 'global',
    'User-Agent': ZEN_USER_AGENT,
  };
}

function isFreeLimitFailure(error: unknown): boolean {
  if (error instanceof FreeUsageLimitError || error instanceof RateLimitError) return true;
  const status =
    (error as { status?: number })?.status ??
    (error as { statusCode?: number })?.statusCode;
  if (status === 429) return true;
  const message = (error as { message?: string })?.message ?? '';
  return /quota|daily limit|rate limit|too many requests/i.test(message);
}

// Parse `retry-after` (AI SDK surfaces it on responseHeaders/headers, or a
// numeric retryAfterMs directly). Numeric values < 1000 are seconds per the
// HTTP spec, larger values are treated as ms. Defaults to 60s.
function getRetryAfterMs(error: unknown): number {
  const direct = (error as { retryAfterMs?: unknown })?.retryAfterMs;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) {
    return direct;
  }
  const headers =
    (error as { responseHeaders?: Record<string, string> })?.responseHeaders ??
    (error as { headers?: Record<string, string> })?.headers;
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed < 1000 ? parsed * 1000 : parsed;
    }
  }
  return 60000;
}

interface ZenModelsResponse {
  object?: string;
  data?: Array<{ id?: unknown }>;
}

async function fetchZenModelIds(): Promise<string[]> {
  // Catalog endpoint responds unauthenticated — auth only on the chat path.
  const response = await fetch(`${ZEN_BASE_URL}/models`, {
    signal: AbortSignal.timeout(ZEN_CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Zen model catalog: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as ZenModelsResponse;
  if (!Array.isArray(body?.data)) return [];
  return body.data
    .map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
    .filter((id) => id.length > 0);
}

let zenCatalogCache: { data: Array<{ id: string; name: string }>; fetchedAt: number } | null = null;
let zenRefreshPromise: Promise<void> | null = null;

async function refreshZenCatalog(): Promise<void> {
  if (zenRefreshPromise) return zenRefreshPromise;
  zenRefreshPromise = (async () => {
    const ids = await fetchZenModelIds();
    // Documented heuristic: today the free set carries `-free` (case
    // sensitive). The list stays authoritative — no checked-in IDs.
    const free = ids
      .filter((id) => id.endsWith('-free'))
      .map((id) => ({ id, name: id }));
    if (free.length === 0) {
      console.warn('[ZenFree] Zen catalog returned no `-free` models; keeping previous list.');
      return;
    }
    zenCatalogCache = { data: free, fetchedAt: Date.now() };
  })();
  try {
    await zenRefreshPromise;
  } finally {
    zenRefreshPromise = null;
  }
}

export class ZenFreeProvider extends BaseProvider {
  readonly name = 'zen-free' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    super();
    // Non-throwing ctor (like OpenRouterFree): keeps listModels() reachable
    // pre-key. Missing-key/model errors surface lazily in getModel().
    const resolved = getZenConfig();
    this.apiKey = apiKey ?? resolved.apiKey ?? '';
    this.model = model ?? resolved.model;
  }

  protected async getModel(): Promise<LanguageModel> {
    if (!this.apiKey) {
      throw new Error(
        'OPENCODE_API_KEY is not set. Get a key at https://opencode.ai/auth and add it in Settings or via the OPENCODE_API_KEY environment variable to use Zen Free.'
      );
    }
    if (!this.model || this.model === 'default') {
      throw new Error('No Zen Free model selected. Pick a model from the live Zen Free list in Settings.');
    }
    const transport = resolveZenTransport(this.model);
    const baseURL = normalizeZenBase(ZEN_BASE_URL);
    const headers = zenStaticHeaders();
    const fetch = withDynamicHeaders(createZenDynamicHeaders);
    switch (transport) {
      case 'openai-responses':
        return createOpenAI({ baseURL, apiKey: this.apiKey, headers, fetch }).responses(this.model);
      case 'anthropic-messages':
        // `authToken` sends `Authorization: Bearer` (Zen's gateway gate);
        // `apiKey` would send `x-api-key` instead.
        return createAnthropic({ baseURL, authToken: this.apiKey, headers, fetch }).messages(
          this.model
        );
      case 'google-generative-ai':
        // `apiKey` lands as `x-goog-api-key`; the explicit Bearer beside it
        // is what the Zen gateway checks. Header merge preserves both.
        return createGoogleGenerativeAI({
          baseURL,
          apiKey: this.apiKey,
          headers: { Authorization: `Bearer ${this.apiKey}`, ...headers },
          fetch,
        })(this.model);
      case 'openai-completions':
      default:
        return createGatewayModel({
          baseURL,
          apiKey: this.apiKey,
          model: this.model,
          headers,
          dynamicHeaders: createZenDynamicHeaders,
        });
    }
  }

  // No beforeComplete override: inherit base SDK retry defaults. No
  // cross-provider fallback — 429s/quota surface as FreeUsageLimitError, a
  // RateLimitError subclass the future fallback chain can catch distinctly.
  async complete(
    messages: Parameters<BaseProvider['complete']>[0],
    options?: Parameters<BaseProvider['complete']>[1]
  ): Promise<LLMResponse> {
    try {
      return await super.complete(messages, options);
    } catch (error) {
      if (error instanceof FreeUsageLimitError) throw error;
      if (isFreeLimitFailure(error)) {
        const retryAfterMs = getRetryAfterMs(error);
        throw new FreeUsageLimitError(
          'Zen Free usage limit reached (OpenCode Zen free tier has unpublished per-model daily limits). ' +
            `Retry after ~${Math.ceil(retryAfterMs / 1000)}s, wait for the daily reset, or switch models/providers.`,
          retryAfterMs
        );
      }
      throw error;
    }
  }

  protected createAgentConfig(): AgentConfig {
    return {
      ...super.createAgentConfig(),
      onStepFinish: async ({ usage, toolCalls, finishReason }) => {
        console.log(`[ZenFree] Step completed: ${finishReason}`);
        if (toolCalls?.length) {
          console.log(`[ZenFree] Tools called: ${toolCalls.map(tc => tc.toolName).join(', ')}`);
        }
        if (usage) {
          console.log(`[ZenFree] Tokens used: ${usage.totalTokens ?? 0}`);
        }
      },
    };
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    // Live IDs-only refresh + free-only filter; background refresh +
    // stale-serve; never throws — on fetch failure serve stale (or [] with
    // no cache), keeping Settings usable. Never silently serve unfiltered.
    const now = Date.now();
    // Local snapshot: zenCatalogCache is module state mutated by
    // refreshZenCatalog(), so narrowing the global directly confuses the
    // control-flow analysis.
    const cached = zenCatalogCache;
    if (cached && now - cached.fetchedAt < ZEN_CATALOG_TTL_MS) {
      return cached.data;
    }
    if (cached) {
      refreshZenCatalog().catch((error) => {
        console.error('[ZenFree] Background catalog refresh failed, serving stale list:', error);
      });
      return cached.data;
    }
    try {
      await refreshZenCatalog();
    } catch (error) {
      console.error('[ZenFree] Failed to fetch Zen model catalog:', error);
      return [];
    }
    return zenCatalogCache?.data ?? [];
  }

  static saveConfig(config: IProviderConfig): void {
    ensureConfigDir();
    const currentConfig = loadFileConfig();
    const newConfig: ZenFreeFileConfig = {
      ...currentConfig,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.model ? { model: config.model } : {}),
    };
    writeFileSync(ZEN_FREE_CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  }

  static name(): string {
    return 'zen-free';
  }

  static displayName(): string {
    return 'Zen Free (OpenCode)';
  }

  static requiresApiKey(): boolean {
    return true;
  }

  static loadConfig(): IProviderConfig {
    // Empty default (model undefined when unset): zero hardcodes, since the
    // free set rotates. getModel() throws a readable "select a model" error
    // when empty (including a stray literal 'default' from updateConfig).
    const resolved = getZenConfig();
    return { model: resolved.model || undefined, apiKey: resolved.apiKey || undefined };
  }

  static hasApiKey(): boolean {
    return !!getZenConfig().apiKey;
  }
}
