import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { LanguageModel } from 'ai';
import { BaseProvider, type AgentConfig } from './base-provider.js';
import { createGatewayModel } from './openai-compatible-helper.js';
import { RateLimitError } from '../errors.js';
import { IProviderConfig, LLMResponse } from '../types.js';

// OpenRouter Free (auto-router) — Phase 1, single `openrouter/free` gateway.
// - Rate limits: 20 req/min, 50/day (1,000/day after a one-time $10 top-up).
// - Free-tier prompts/outputs may be logged upstream by OpenRouter/model hosts.
// - The router picks a different underlying free model per request, so output
//   quality and capabilities vary between calls (no reproducibility guarantee).
// - No live /models sync, no fallback chain (see #85 for zen-free / Phase 2).
// - Never log the API key.

export const OPENROUTER_FREE_MODEL_ID = 'openrouter/free';
export const OPENROUTER_FREE_DISPLAY_NAME = 'OpenRouter Free (auto-router)';

const CONFIG_DIR = join(process.cwd(), '.cycledesign');
const OPENROUTER_FREE_CONFIG_FILE = join(CONFIG_DIR, 'openrouter-free.json');

interface OpenRouterFreeFileConfig {
  apiKey?: string;
  model?: string;
}

export interface OpenRouterFreeResolvedConfig {
  apiKey: string | undefined;
  model: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadFileConfig(): OpenRouterFreeFileConfig {
  try {
    if (existsSync(OPENROUTER_FREE_CONFIG_FILE)) {
      const data = readFileSync(OPENROUTER_FREE_CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load OpenRouter Free config:', error);
  }
  return {};
}

// Single resolution point used by the ctor + static loadConfig()/hasApiKey().
// Precedence: env > file > default. OPENROUTER_FREE_MODEL is namespaced;
// FREE_MODEL is accepted as a legacy fallback.
export function getOpenRouterConfig(): OpenRouterFreeResolvedConfig {
  const file = loadFileConfig();
  return {
    apiKey: process.env.OPENROUTER_API_KEY ?? file.apiKey,
    model:
      process.env.OPENROUTER_FREE_MODEL ??
      process.env.FREE_MODEL ??
      file.model ??
      OPENROUTER_FREE_MODEL_ID,
  };
}

function isRateLimitFailure(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  const status =
    (error as { status?: number })?.status ??
    (error as { statusCode?: number })?.statusCode;
  if (status === 429) return true;
  const message = (error as { message?: string })?.message ?? '';
  return /429|rate limit|rate_limit|too many requests|daily limit|quota exceeded/i.test(message);
}

export class OpenRouterFreeProvider extends BaseProvider {
  readonly name = 'openrouter-free' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    super();
    // Non-throwing ctor (unlike Mistral): keeps the static listModels() entry
    // reachable pre-key via getProviderInstance() -> listModels(). Missing-key
    // errors surface lazily in getModel().
    const resolved = getOpenRouterConfig();
    this.apiKey = apiKey ?? resolved.apiKey ?? '';
    this.model = model ?? resolved.model;
  }

  protected async getModel(): Promise<LanguageModel> {
    if (!this.apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY is not set. Add it in Settings or via the OPENROUTER_API_KEY environment variable to use OpenRouter Free.'
      );
    }
    return createGatewayModel({ apiKey: this.apiKey, model: this.model });
  }

  // No beforeComplete override: inherit base SDK retry defaults. No
  // cross-provider fallback — 429s surface as a readable limit message.
  async complete(
    messages: Parameters<BaseProvider['complete']>[0],
    options?: Parameters<BaseProvider['complete']>[1]
  ): Promise<LLMResponse> {
    try {
      return await super.complete(messages, options);
    } catch (error) {
      if (isRateLimitFailure(error)) {
        throw new Error(
          'OpenRouter Free rate limit reached (20 requests/min, 50/day; 1,000/day after a one-time $10 top-up). ' +
            'Per-minute limits recover on manual retry (the router re-rolls); daily limits block until reset or top-up.'
        );
      }
      throw error;
    }
  }

  protected createAgentConfig(): AgentConfig {
    return {
      ...super.createAgentConfig(),
      onStepFinish: async ({ usage, toolCalls, finishReason }) => {
        console.log(`[OpenRouterFree] Step completed: ${finishReason}`);
        if (toolCalls?.length) {
          console.log(`[OpenRouterFree] Tools called: ${toolCalls.map(tc => tc.toolName).join(', ')}`);
        }
        if (usage) {
          console.log(`[OpenRouterFree] Tokens used: ${usage.totalTokens ?? 0}`);
        }
      },
    };
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    // Static single entry, no live fetch in Phase 1 — reachable even pre-key.
    return [{ id: OPENROUTER_FREE_MODEL_ID, name: OPENROUTER_FREE_DISPLAY_NAME }];
  }

  static saveConfig(config: IProviderConfig): void {
    ensureConfigDir();
    const currentConfig = loadFileConfig();
    const newConfig: OpenRouterFreeFileConfig = {
      ...currentConfig,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.model ? { model: config.model } : {}),
    };
    writeFileSync(OPENROUTER_FREE_CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  }

  static name(): string {
    return 'openrouter-free';
  }

  static displayName(): string {
    return 'OpenRouter Free (auto-router)';
  }

  static requiresApiKey(): boolean {
    return true;
  }

  static loadConfig(): IProviderConfig {
    // Default-bearing: always returns the resolved model so updateConfig's
    // `model || currentProviderConfig?.model || 'default'` chain can never
    // write a literal 'default' for this provider.
    const resolved = getOpenRouterConfig();
    return { model: resolved.model, apiKey: resolved.apiKey || undefined };
  }

  static hasApiKey(): boolean {
    return !!getOpenRouterConfig().apiKey;
  }
}
