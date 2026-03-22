import { createMistral, type MistralProvider as AISDKMistralProvider } from '@ai-sdk/mistral';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BaseProvider, type AgentConfig } from './base-provider.js';
import { IProviderConfig } from '../types.js';

const CONFIG_DIR = join(process.cwd(), '.cycledesign');
const MISTRAL_CONFIG_FILE = join(CONFIG_DIR, 'mistral.json');
const MISTRAL_KEY_FILE = join(CONFIG_DIR, 'mistral-api-key');

interface MistralConfig {
  apiKey?: string;
  model?: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig(): MistralConfig {
  try {
    // First try new config file
    if (existsSync(MISTRAL_CONFIG_FILE)) {
      const data = readFileSync(MISTRAL_CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
    // Fallback to legacy key file for backwards compatibility
    if (existsSync(MISTRAL_KEY_FILE)) {
      const apiKey = readFileSync(MISTRAL_KEY_FILE, 'utf-8').trim();
      if (apiKey) {
        return { apiKey };
      }
    }
  } catch (error) {
    console.error('Failed to load Mistral config:', error);
  }
  return {};
}

export class MistralProvider extends BaseProvider {
  readonly name = 'mistral' as const;
  private apiKey: string;
  private model: string;
  private mistralProvider: AISDKMistralProvider;

  constructor(apiKey?: string, model?: string) {
    super();
    const config = loadConfig();
    this.apiKey = apiKey || config.apiKey || '';
    this.model = model || config.model || 'codestral-2508';
    if (!this.apiKey) {
      throw new Error('MISTRAL_API_KEY is not set');
    }
    this.mistralProvider = createMistral({ apiKey: this.apiKey });
  }

  protected async getModel() {
    return this.mistralProvider(this.model);
  }

  protected createAgentConfig(): AgentConfig {
    return {
      ...super.createAgentConfig(),
      onStepFinish: async ({ usage, toolCalls, finishReason }) => {
        console.log(`[Mistral] Step completed: ${finishReason}`);
        if (toolCalls?.length) {
          console.log(`[Mistral] Tools called: ${toolCalls.map(tc => tc.toolName).join(', ')}`);
        }
        if (usage) {
          console.log(`[Mistral] Tokens used: ${usage.totalTokens ?? 0}`);
        }
      },
    };
  }

  async listModels(): Promise<{ id: string; name: string }[]> {
    if (!this.apiKey) {
      return [];
    }
    try {
      const models = await listMistralModels(this.apiKey);
      return models.map((id) => ({ id, name: id }));
    } catch (error) {
      console.error('Failed to fetch Mistral models:', error);
      return [];
    }
  }

  static saveConfig(config: IProviderConfig): void {
    ensureConfigDir();
    const currentConfig = loadConfig();
    const newConfig: MistralConfig = {
      ...currentConfig,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.model ? { model: config.model } : {}),
    };
    writeFileSync(MISTRAL_CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  }

  static name(): string {
    return 'mistral';
  }

  static displayName(): string {
    return 'Mistral (API Key)';
  }

  static requiresApiKey(): boolean {
    return true;
  }

  static loadConfig(): IProviderConfig {
    const config = loadConfig();
    return { model: config.model || undefined, apiKey: config.apiKey || undefined };
  }

  static hasApiKey(): boolean {
    const config = loadConfig();
    return !!config.apiKey;
  }
}

export interface MistralModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface MistralModelsResponse {
  object: string;
  data: MistralModel[];
}

export async function listMistralModels(apiKey: string): Promise<string[]> {
  const response = await fetch('https://api.mistral.ai/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.statusText}`);
  }

  const data: MistralModelsResponse = await response.json();
  return data.data
    ?.filter((m) => m.id.includes('devstral') || m.id.includes('codestral'))
    ?.map((m) => m.id) || [];
}
