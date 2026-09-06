import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  OpenRouterFreeProvider,
  getOpenRouterConfig,
  OPENROUTER_FREE_MODEL_ID,
} from './openrouter-free.js';
import { createGatewayModel, OPENROUTER_BASE_URL } from './openai-compatible-helper.js';

const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENROUTER_FREE_MODEL', 'FREE_MODEL'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('OpenRouterFreeProvider', () => {
  it('should return correct statics', () => {
    expect(OpenRouterFreeProvider.name()).toBe('openrouter-free');
    expect(OpenRouterFreeProvider.displayName()).toBe('OpenRouter Free (auto-router)');
    expect(OpenRouterFreeProvider.requiresApiKey()).toBe(true);
  });

  it('should list the static single entry without a key (non-throwing ctor)', async () => {
    const provider = new OpenRouterFreeProvider();
    expect(await provider.listModels()).toEqual([
      { id: OPENROUTER_FREE_MODEL_ID, name: 'OpenRouter Free (auto-router)' },
    ]);
  });

  it('should throw a readable missing-key error from complete() without a key', async () => {
    const provider = new OpenRouterFreeProvider('test-key', 'openrouter/free');
    // Sanity: explicit key reaches the gateway without network access.
    expect(provider).toBeDefined();
    const noKey = new OpenRouterFreeProvider();
    await expect(
      noKey.complete([{ role: 'user' as const, content: 'hi' }])
    ).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('should prefer env over default in getOpenRouterConfig', () => {
    process.env.OPENROUTER_API_KEY = 'env-key';
    process.env.OPENROUTER_FREE_MODEL = 'some/test-model:free';
    const resolved = getOpenRouterConfig();
    expect(resolved.apiKey).toBe('env-key');
    expect(resolved.model).toBe('some/test-model:free');
  });

  it('should default to the auto-router gateway', () => {
    expect(getOpenRouterConfig().model).toBe(OPENROUTER_FREE_MODEL_ID);
  });
});

describe('createGatewayModel', () => {
  it('should build a V3 LanguageModel for the router gateway', () => {
    const model = createGatewayModel({ apiKey: 'test-key', model: OPENROUTER_FREE_MODEL_ID });
    // Cast: ai v6's LanguageModel union narrows modelId/specificationVersion per
    // member, so assert structurally on the runtime shape instead.
    const shape = model as unknown as { modelId: string; specificationVersion: string };
    expect(shape.modelId).toBe(OPENROUTER_FREE_MODEL_ID);
    // Pinned v2 returns the V3 spec ai v6 ToolLoopAgent accepts (v3 speaks V4).
    expect(shape.specificationVersion).toBe('v3');
    expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });
});
