import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalProvider,
  getLocalConfig,
  normalizeBaseURL,
  LOCAL_DEFAULT_BASE_URL,
} from './local.js';

const ENV_KEYS = [
  'LOCAL_LLM_BASE_URL',
  'LOCAL_LLM_MODEL',
  'LOCAL_LLM_API_KEY',
  'CYCLEDESIGN_CONFIG_DIR',
  'CYCLEDESIGN_E2E',
] as const;
let savedEnv: Record<string, string | undefined>;
let tmpDir: string;

function connectionRefusedFetch(): typeof fetch {
  const error = Object.assign(new Error('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
      code: 'ECONNREFUSED',
    }),
  });
  return vi.fn().mockRejectedValue(error) as unknown as typeof fetch;
}

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'cycledesign-local-test-'));
  process.env.CYCLEDESIGN_CONFIG_DIR = tmpDir;
  vi.unstubAllGlobals();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('LocalProvider statics', () => {
  it('should return correct statics', () => {
    expect(LocalProvider.name()).toBe('local');
    expect(LocalProvider.displayName()).toBe('Local LLM (custom URL)');
    expect(LocalProvider.requiresApiKey()).toBe(false);
  });

  it('should construct without throwing pre-config', () => {
    expect(() => new LocalProvider()).not.toThrow();
  });
});

describe('normalizeBaseURL', () => {
  it.each([
    ['http://localhost:11434', 'http://localhost:11434/v1'],
    ['http://localhost:11434/', 'http://localhost:11434/v1'],
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
    ['http://localhost:11434/v1/', 'http://localhost:11434/v1'],
    ['http://localhost:11434/v1/chat/completions', 'http://localhost:11434/v1'],
    ['http://localhost:1234/v1', 'http://localhost:1234/v1'],
    ['  http://localhost:1234/v1  ', 'http://localhost:1234/v1'],
    ['', ''],
  ])('normalizeBaseURL(%j) === %j', (input, expected) => {
    expect(normalizeBaseURL(input)).toBe(expected);
  });
});

describe('getLocalConfig precedence', () => {
  it('should default to Ollama with an empty model', () => {
    expect(getLocalConfig()).toEqual({
      baseURL: LOCAL_DEFAULT_BASE_URL,
      model: '',
      apiKey: undefined,
    });
  });

  it('should prefer env over file over default', async () => {
    LocalProvider.saveConfig({
      baseURL: 'http://localhost:1234/v1',
      model: 'file-model',
      apiKey: 'file-key',
    });
    expect(getLocalConfig()).toMatchObject({
      baseURL: 'http://localhost:1234/v1',
      model: 'file-model',
      apiKey: 'file-key',
    });
    process.env.LOCAL_LLM_BASE_URL = 'http://env-host:8080/v1';
    process.env.LOCAL_LLM_MODEL = 'env-model';
    process.env.LOCAL_LLM_API_KEY = 'env-key';
    expect(getLocalConfig()).toMatchObject({
      baseURL: 'http://env-host:8080/v1',
      model: 'env-model',
      apiKey: 'env-key',
    });
  });

  it('should persist baseURL/model/apiKey across reloads (file round-trip)', async () => {
    LocalProvider.saveConfig({
      baseURL: 'http://localhost:1234/v1/chat/completions',
      model: 'qwen3:8b',
      apiKey: 'secret',
    });
    const raw = await fs.readFile(join(tmpDir, 'local.json'), 'utf-8');
    // Normalized once at save (single owner): no /chat/completions suffix.
    expect(JSON.parse(raw)).toEqual({
      baseURL: 'http://localhost:1234/v1',
      model: 'qwen3:8b',
      apiKey: 'secret',
    });
    expect(getLocalConfig()).toMatchObject({
      baseURL: 'http://localhost:1234/v1',
      model: 'qwen3:8b',
      apiKey: 'secret',
    });
  });
});

describe('listModels', () => {
  it('should return live IDs from GET {baseURL}/models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'llama3.1:8b' }, { id: 'qwen3:8b' }] }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new LocalProvider(undefined, 'fallback-model', 'http://localhost:11434/v1');
    expect(await provider.listModels()).toEqual([
      { id: 'llama3.1:8b', name: 'llama3.1:8b' },
      { id: 'qwen3:8b', name: 'qwen3:8b' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/v1/models',
      expect.anything()
    );
  });

  it('should send Authorization iff a key is configured', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    await new LocalProvider('secret-key', 'm', 'http://h/v1').listModels();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer secret-key' },
    });
    fetchMock.mockClear();
    await new LocalProvider(undefined, 'm', 'http://h/v1').listModels();
    expect(fetchMock.mock.calls[0][1] ?? {}).not.toHaveProperty('headers');
  });

  it('should fall back to the configured model when unreachable, never throw', async () => {
    vi.stubGlobal('fetch', connectionRefusedFetch());
    const provider = new LocalProvider(undefined, 'my-model', 'http://localhost:11434/v1');
    await expect(provider.listModels()).resolves.toEqual([{ id: 'my-model', name: 'my-model' }]);
  });

  it('should return [] offline with no configured model, never throw', async () => {
    vi.stubGlobal('fetch', connectionRefusedFetch());
    const provider = new LocalProvider(undefined, '', 'http://localhost:11434/v1');
    await expect(provider.listModels()).resolves.toEqual([]);
  });
});

describe('complete() error mapping', () => {
  it(
    'should surface connection-refused as an actionable message naming the baseURL',
    async () => {
      vi.stubGlobal('fetch', connectionRefusedFetch());
      const provider = new LocalProvider(undefined, 'llama3.1:8b', 'http://localhost:11434/v1');
      await expect(
        provider.complete([{ role: 'user' as const, content: 'hi' }])
      ).rejects.toThrow(/Cannot reach the Local LLM server at http:\/\/localhost:11434\/v1/);
    },
    // ToolLoopAgent retries with backoff before surfacing the failure.
    60000
  );

  it('should map 401 to an API-key hint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
      ) as unknown as typeof fetch
    );
    const provider = new LocalProvider(undefined, 'llama3.1:8b', 'http://localhost:11434/v1');
    await expect(
      provider.complete([{ role: 'user' as const, content: 'hi' }])
    ).rejects.toThrow(/401.*API key|API key.*401/s);
  });

  it('should throw a validation error when the model is missing', async () => {
    const provider = new LocalProvider(undefined, '', 'http://localhost:11434/v1');
    await expect(
      provider.complete([{ role: 'user' as const, content: 'hi' }])
    ).rejects.toThrow(/model is not set/);
  });

  it('should throw a validation error for an invalid baseURL', async () => {
    const provider = new LocalProvider(undefined, 'm', 'not-a-url');
    await expect(
      provider.complete([{ role: 'user' as const, content: 'hi' }])
    ).rejects.toThrow(/base URL is invalid/);
  });
});
