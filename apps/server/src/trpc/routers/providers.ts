import { router, publicProcedure } from '../init.js';
import { z } from 'zod';
import { MistralProvider } from '../../llm/providers/mistral.js';
import { QwenProvider } from '../../llm/providers/qwen.js';
import { OpenRouterFreeProvider } from '../../llm/providers/openrouter-free.js';
import { ZenFreeProvider } from '../../llm/providers/zen-free.js';
import { LocalProvider } from '../../llm/providers/local.js';
import { MockProvider } from '../../llm/providers/mock.js';
import { BaseProvider } from '../../llm/providers/base-provider.js';
import { clearProviderCache } from '../../llm/providers/provider-factory.js';
import { IProvider, IProviderClass, IProviderConfig } from '../../llm/types.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface ProviderConfig {
  provider: string;
}

// Helper function to get current provider config (for use by other modules)
export function getProviderConfig(): { provider: string } {
  return { provider: configState.current.provider };
}

const CONFIG_DIR =
  process.env.CYCLEDESIGN_CONFIG_DIR ??
  (process.env.CYCLEDESIGN_E2E === '1'
    ? join(process.cwd(), '.cycledesign-e2e')
    : join(process.cwd(), '.cycledesign'));
const CONFIG_FILE = join(CONFIG_DIR, 'provider-config.json');

const providers: IProviderClass[] = [
  QwenProvider,
  MistralProvider,
  OpenRouterFreeProvider,
  ZenFreeProvider,
  LocalProvider,
  ...(process.env.ENABLE_MOCK_PROVIDER === 'true' ? [MockProvider] : []),
];
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
    baseURL: z.string().optional(),
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
    // Get model/baseURL from provider's own config
    const providerConfig = providerClass?.loadConfig();
    return {
      provider: configState.current.provider,
      model: providerConfig?.model,
      baseURL: providerConfig?.baseURL,
      hasApiKey,
    };
  }),

  // POST /api/providers/config - Update config
  updateConfig: publicProcedure
    .input(providerSchemas.provider)
    .mutation(async ({ input }) => {
      const { provider, apiKey, model, baseURL } = input;

      const previousProvider = configState.current.provider;

      // Unknown providers (e.g. mock without the flag) are a silent no-op:
      // return previous state without writing any config or clearing caches.
      if (provider && !providerMap.has(provider)) {
        const previousClass = providerMap.get(previousProvider);
        const previousConfig = previousClass?.loadConfig();
        return {
          provider: previousProvider,
          model: previousConfig?.model || '',
          baseURL: previousConfig?.baseURL,
          hasApiKey: previousClass?.hasApiKey?.() ?? false,
        };
      }

      const newProvider = provider && providerMap.has(provider)
        ? provider
        : previousProvider;

      const providerClass = providerMap.get(newProvider);
      const currentProviderConfig = providerClass?.loadConfig();

      const newProviderConfig: IProviderConfig = {
        // Local has no default model: resolve to '' (never a literal
        // 'default') so a wrong model is never silently pinned. Normalization
        // of baseURL lives in LocalProvider.saveConfig (single owner).
        model: model || currentProviderConfig?.model || (newProvider === 'local' ? '' : 'default'),
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      };

      // Save to provider's own config file (e.g., mistral-api-key)
      providerClass?.saveConfig(newProviderConfig);

      // Selection stays on the previous provider, no error path.
      if (provider && provider !== previousProvider) {
        configState.current.provider = provider;
        saveConfig(configState.current);
      }

      // Clear cached provider instances (router-level + factory-level) plus
      // any cached agent so a saved key/model reaches the chat path
      // without a restart.
      if (cachedProviderInstance instanceof BaseProvider) {
        cachedProviderInstance.clearCachedAgent();
      }
      cachedProviderInstance = null;
      clearProviderCache();

      const hasApiKey = providerClass?.hasApiKey?.() ?? false;
      return {
        provider: configState.current.provider,
        model: newProviderConfig.model || '',
        baseURL: providerClass?.loadConfig()?.baseURL,
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
