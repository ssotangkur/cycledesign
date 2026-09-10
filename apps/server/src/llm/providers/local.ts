import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { LanguageModel } from 'ai';
import { BaseProvider, type AgentConfig } from './base-provider.js';
import { createGatewayModel } from './openai-compatible-helper.js';
import { getConfigDir } from './config-dir.js';
import { IProviderConfig, LLMResponse } from '../types.js';

// Local LLM (custom OpenAI-compatible baseURL) — Ollama / LM Studio / vLLM /
// llama.cpp server, etc.
// - No default model: the user picks explicitly (never auto-pinned).
// - API key is optional: vanilla Ollama/LM Studio need none; servers launched
//   with a key (e.g. vLLM --api-key) send it as Bearer. No Authorization
//   header is sent when no key is configured.
// - Resolution precedence: env > file > default. File: <configDir>/local.json.
// - Never logs the API key or the full baseURL secret.

export const LOCAL_DEFAULT_BASE_URL = 'http://localhost:11434/v1';
export const LOCAL_PROVIDER_NAME = 'local';
export const LOCAL_PROVIDER_DISPLAY_NAME = 'Local LLM (custom URL)';

const LOCAL_CONFIG_FILE = () => join(getConfigDir(), 'local.json');

interface LocalFileConfig {
  baseURL?: string;
  model?: string;
  apiKey?: string;
}

export interface LocalResolvedConfig {
  baseURL: string;
  model: string;
  apiKey: string | undefined;
}

function ensureConfigDir(): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadFileConfig(): LocalFileConfig {
  try {
    if (existsSync(LOCAL_CONFIG_FILE())) {
      const data = readFileSync(LOCAL_CONFIG_FILE(), 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load Local LLM config:', error);
  }
  return {};
}

// Normalize user input to the OpenAI-compatible root used for both
// GET {baseURL}/models and the gateway factory: trim, strip trailing
// slashes, strip a pasted /chat/completions suffix, then ensure a /v1 path.
export function normalizeBaseURL(input: string): string {
  let value = input.trim().replace(/\/+$/, '');
  value = value.replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
  if (!value) return value;
  if (!/\/v1$/.test(value)) {
    value = `${value}/v1`;
  }
  return value;
}

// Single resolution point used by the ctor + static loadConfig()/hasApiKey().
// Precedence: env > file > default. No default model (empty string).
export function getLocalConfig(): LocalResolvedConfig {
  const file = loadFileConfig();
  const fallback = process.env.LOCAL_LLM_BASE_URL ?? file.baseURL ?? LOCAL_DEFAULT_BASE_URL;
  return {
    baseURL: normalizeBaseURL(fallback),
    model: process.env.LOCAL_LLM_MODEL ?? file.model ?? '',
    apiKey: process.env.LOCAL_LLM_API_KEY ?? file.apiKey,
  };
}

function isConnectionFailure(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? '';
  const cause = (error as { cause?: unknown })?.cause;
  const causeMessage =
    typeof cause === 'string'
      ? cause
      : ((cause as { message?: string })?.message ??
        (cause as { code?: string })?.code ??
        '');
  const combined = `${message} ${causeMessage}`;
  return /ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH|fetch failed|failed to fetch|network error|load failed/i.test(
    combined
  );
}

function failureStatus(error: unknown): number | undefined {
  return (
    (error as { status?: number })?.status ??
    (error as { statusCode?: number })?.statusCode ??
    ((error as { cause?: unknown })?.cause as { status?: number } | undefined)?.status
  );
}

export class LocalProvider extends BaseProvider {
  readonly name = LOCAL_PROVIDER_NAME as const;
  private baseURL: string;
  private model: string;
  private apiKey: string | undefined;

  constructor(apiKey?: string, model?: string, baseURL?: string) {
    super();
    // Non-throwing ctor (like OpenRouterFreeProvider): keeps the entry
    // selectable pre-config. Missing-baseURL/model errors surface lazily in
    // getModel(); connection errors surface in complete().
    const resolved = getLocalConfig();
    this.apiKey = apiKey ?? resolved.apiKey;
    this.model = model ?? resolved.model;
    this.baseURL = baseURL ?? resolved.baseURL;
  }

  protected async getModel(): Promise<LanguageModel> {
    if (!this.baseURL) {
      throw new Error(
        'Local LLM base URL is not set. Set it in Settings or via the LOCAL_LLM_BASE_URL environment variable (e.g. http://localhost:11434/v1 for Ollama, http://localhost:1234/v1 for LM Studio).'
      );
    }
    try {
      // Validate without logging the URL secret.
      new URL(this.baseURL);
    } catch {
      throw new Error(
        'Local LLM base URL is invalid. Set it in Settings or via LOCAL_LLM_BASE_URL (e.g. http://localhost:11434/v1 for Ollama, http://localhost:1234/v1 for LM Studio).'
      );
    }
    if (!this.model) {
      throw new Error(
        'Local LLM model is not set. Pick a model in Settings or via the LOCAL_LLM_MODEL environment variable.'
      );
    }
    return createGatewayModel({
      baseURL: this.baseURL,
      name: 'local',
      model: this.model,
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
    });
  }

  // Connection failures surface inside agent.generate/stream (not at model
  // construction), so the mapping belongs here. Names the baseURL so the
  // message is actionable; never includes the API key.
  async complete(
    messages: Parameters<BaseProvider['complete']>[0],
    options?: Parameters<BaseProvider['complete']>[1]
  ): Promise<LLMResponse> {
    try {
      return await super.complete(messages, options);
    } catch (error) {
      if (failureStatus(error) === 401) {
        throw new Error(
          `Local LLM server at ${this.baseURL} rejected the request (401 Unauthorized). If the server requires an API key, set it in Settings or via LOCAL_LLM_API_KEY.`
        );
      }
      if (isConnectionFailure(error)) {
        throw new Error(
          `Cannot reach the Local LLM server at ${this.baseURL} — is it running? Start Ollama (default ${LOCAL_DEFAULT_BASE_URL}) or point the Base URL in Settings at your server (e.g. LM Studio http://localhost:1234/v1).`
        );
      }
      throw error;
    }
  }

  protected createAgentConfig(): AgentConfig {
    return {
      ...super.createAgentConfig(),
      onStepFinish: async ({ usage, toolCalls, finishReason }) => {
        console.log(`[Local] Step completed: ${finishReason}`);
        if (toolCalls?.length) {
          console.log(`[Local] Tools called: ${toolCalls.map((tc) => tc.toolName).join(', ')}`);
        }
        if (usage) {
          console.log(`[Local] Tokens used: ${usage.totalTokens ?? 0}`);
        }
      },
    };
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    // Live GET {baseURL}/models (OpenAI shape { data: [{ id }] }). Never
    // throws: offline/unreachable servers fall back to the configured model
    // (or []) so the Settings dropdown stays usable.
    const fallback = this.model ? [{ id: this.model, name: this.model }] : [];
    if (!this.baseURL) {
      return fallback;
    }
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        ...(this.apiKey ? { headers: { Authorization: `Bearer ${this.apiKey}` } } : {}),
      });
      if (!response.ok) {
        return fallback;
      }
      const data = (await response.json()) as { data?: Array<{ id?: string }> };
      const ids = (data.data ?? [])
        .map((entry) => entry?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      if (ids.length === 0) {
        return fallback;
      }
      return ids.map((id) => ({ id, name: id }));
    } catch (error) {
      console.error('Failed to fetch Local LLM models:', error);
      return fallback;
    }
  }

  static saveConfig(config: IProviderConfig): void {
    ensureConfigDir();
    const currentConfig = loadFileConfig();
    const newConfig: LocalFileConfig = {
      ...currentConfig,
      ...(config.baseURL ? { baseURL: normalizeBaseURL(config.baseURL) } : {}),
      ...(config.model ? { model: config.model } : {}),
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    };
    writeFileSync(LOCAL_CONFIG_FILE(), JSON.stringify(newConfig, null, 2));
  }

  static name(): string {
    return LOCAL_PROVIDER_NAME;
  }

  static displayName(): string {
    return LOCAL_PROVIDER_DISPLAY_NAME;
  }

  static requiresApiKey(): boolean {
    return false;
  }

  static loadConfig(): IProviderConfig {
    // No default model: returns '' so the router's 'default' guard and the
    // Settings UI keep an explicit-choice UX instead of pinning a wrong model.
    const resolved = getLocalConfig();
    return {
      model: resolved.model || undefined,
      baseURL: resolved.baseURL,
      apiKey: resolved.apiKey || undefined,
    };
  }

  static hasApiKey(): boolean {
    return !!getLocalConfig().apiKey;
  }
}
