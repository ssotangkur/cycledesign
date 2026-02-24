import { Router } from 'express';
import { listMistralModels } from '../llm/providers/mistral';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const router = Router();

interface ProviderConfig {
  provider: 'qwen' | 'mistral';
  mistralApiKey?: string;
  model?: string;
}

const CONFIG_DIR = join(process.cwd(), '.cycledesign');
const CONFIG_FILE = join(CONFIG_DIR, 'provider-config.json');

function loadConfig(): ProviderConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      const config = JSON.parse(data);
      if (config.mistralApiKey) {
        process.env.MISTRAL_API_KEY = config.mistralApiKey;
      }
      return config;
    }
  } catch (error) {
    console.error('Failed to load provider config:', error);
  }
  return { provider: 'qwen', model: 'coder-model' };
}

function saveConfig(config: ProviderConfig): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Failed to save provider config:', error);
  }
}

let currentConfig: ProviderConfig = loadConfig();

router.get('/config', (_req, res) => {
  res.json({
    provider: currentConfig.provider,
    model: currentConfig.model,
    hasMistralKey: !!currentConfig.mistralApiKey,
  });
});

router.post('/config', (req, res) => {
  const { provider, apiKeys, model } = req.body;
  
  if (provider && ['qwen', 'mistral'].includes(provider)) {
    currentConfig.provider = provider;
  }
  
  if (model) {
    currentConfig.model = model;
  }
  
  if (apiKeys?.mistral) {
    currentConfig.mistralApiKey = apiKeys.mistral;
    process.env.MISTRAL_API_KEY = apiKeys.mistral;
  }
  
  saveConfig(currentConfig);
  
  res.json({
    provider: currentConfig.provider,
    model: currentConfig.model,
    hasMistralKey: !!currentConfig.mistralApiKey,
  });
});

router.get('/models', async (_req, res) => {
  const models: { id: string; name: string }[] = [];
  
  if (currentConfig.provider === 'qwen') {
    models.push(
      { id: 'coder-model', name: 'Qwen Coder (1M context)' },
      { id: 'vision-model', name: 'Qwen Vision (128K context)' }
    );
  } else if (currentConfig.provider === 'mistral') {
    if (currentConfig.mistralApiKey) {
      try {
        const mistralModels = await listMistralModels(currentConfig.mistralApiKey);
        models.push(...mistralModels.map((id) => ({ id, name: id })));
      } catch (error) {
        console.error('Failed to fetch Mistral models:', error);
      }
    }
    if (models.length === 0) {
      models.push(
        { id: 'devstral-2-2512', name: 'Devstral 2 (256K context)' },
        { id: 'codestral-latest', name: 'Codestral' }
      );
    }
  }
  
  res.json({ models });
});

export function getProviderConfig(): ProviderConfig {
  return currentConfig;
}

export function setProviderConfig(config: Partial<ProviderConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

export default router;
