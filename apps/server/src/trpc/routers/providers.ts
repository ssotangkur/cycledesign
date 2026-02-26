import { router, publicProcedure } from '../init';
import { z } from 'zod';
import { MistralProvider } from '../../llm/providers/mistral';
import { QwenProvider } from '../../llm/providers/qwen';
import { IProvider, IProviderClass, IProviderConfig } from '../../llm/types';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface ProviderConfig {
  provider: string;
}

// Helper function to get current provider config (for use by other modules)
export function getProviderConfig(): { provider: string } {
  return { provider: configState.current.provider };
}

const CONFIG_DIR = join(process.cwd(), '.cycledesign');
const CONFIG_FILE = join(CONFIG_DIR, 'provider-config.json');

const providers: IProviderClass[] = [QwenProvider, MistralProvider];
const providerMap = new Map(providers.map((p) => [p.name(), p]));

let cachedProviderInstance: IProvider | null = null;

// Use an object wrapper to allow mutation of config
const configState: { current: ProviderConfig } = { current: loadConfig() };

function getProviderInstance(): IProvider {
  if (cachedProviderInstance && cachedProviderInstance.name === configState.current.provider) {
    return cachedProviderInstance;
  }
  const ProviderClass = providerMap.get(configState.current.provider);
  if (!ProviderClass) {
    throw new Error(`Unknown provider: ${configState.current.provider}`);
  }
  cachedProviderInstance = new ProviderClass();
  return cachedProviderInstance;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig(): ProviderConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      const config = JSON.parse(data);
      return { provider: config.provider };
    }
  } catch (error) {
    console.error('Failed to load provider config:', error);
  }
  return { provider: providers[0].name() };
}

function saveConfig(config: ProviderConfig): void {
  try {
    ensureConfigDir();
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Failed to save provider config:', error);
  }
}

const providerSchemas = {
  provider: z.object({
    provider: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
  }),
};

export const providersRouter = router({
  // GET /api/providers - List all providers
  list: publicProcedure.query(async () => {
    return providers.map((p) => ({
      name: p.name(),
      displayName: p.displayName(),
      requiresApiKey: p.requiresApiKey(),
    }));
  }),

  // GET /api/providers/config - Get current config
  getConfig: publicProcedure.query(async () => {
    const providerClass = providerMap.get(configState.current.provider);
    const hasApiKey = providerClass?.hasApiKey?.() ?? false;
    // Get model from provider's own config
    const model = providerClass?.loadConfig()?.model;
    return {
      provider: configState.current.provider,
      model,
      hasApiKey,
    };
  }),

  // POST /api/providers/config - Update config
  updateConfig: publicProcedure
    .input(providerSchemas.provider)
    .mutation(async ({ input }) => {
      const { provider, apiKey, model } = input;

      const previousProvider = configState.current.provider;
      const newProvider = provider && providerMap.has(provider)
        ? provider
        : previousProvider;

      const providerClass = providerMap.get(newProvider);
      const currentProviderConfig = providerClass?.loadConfig();

      const newProviderConfig: IProviderConfig = {
        model: model || currentProviderConfig?.model || 'default',
        ...(apiKey ? { apiKey } : {}),
      };

      // Save to provider's own config file (e.g., mistral-api-key)
      providerClass?.saveConfig(newProviderConfig);

      if (provider && provider !== previousProvider) {
        configState.current.provider = provider;
        saveConfig(configState.current);
      }

      // Clear cached provider instance
      cachedProviderInstance = null;

      const hasApiKey = providerClass?.hasApiKey?.() ?? false;
      return {
        provider: configState.current.provider,
        model: newProviderConfig.model || '',
        hasApiKey,
      };
    }),

  // GET /api/providers/models - List models for current provider
  listModels: publicProcedure.query(async () => {
    const providerInstance = getProviderInstance();
    const models = await providerInstance.listModels();
    return models;
  }),
});
