import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageModel } from 'ai';

const ENV_KEYS = ['OPENCODE_API_KEY', 'ZEN_FREE_MODEL', 'CYCLEDESIGN_CONFIG_DIR'] as const;
let savedEnv: Record<string, string | undefined>;
let tmpDir: string;
let cwdSpy: { mockRestore: () => void };

type ZenModule = typeof import('./zen-free.js');
type ErrorsModule = typeof import('../errors.js');
let mod: ZenModule;
let errMod: ErrorsModule;

async function loadModule(): Promise<ZenModule> {
  vi.resetModules();
  // Reload errors alongside zen-free: zen-free.js imports ../errors.js, so
  // instanceof checks must use this same fresh copy, not the static import.
  errMod = await import('../errors.js');
  mod = await import('./zen-free.js');
  return mod;
}

function stubCatalogFetch(ids: Array<{ id?: unknown } | string>, ok = true, status = 200) {
  const fetchMock = vi.fn(async () =>
    ok
      ? new Response(JSON.stringify({ data: ids.map((e) => (typeof e === 'string' ? { id: e } : e)) }), {
          status,
        })
      : new Response('err', { status, statusText: 'Too Many Requests' })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'cycledesign-zenfree-test-'));
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  await loadModule();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  cwdSpy.mockRestore();
  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ZenFreeProvider statics', () => {
  it('should return correct statics', () => {
    expect(mod.ZenFreeProvider.name()).toBe('zen-free');
    expect(mod.ZenFreeProvider.displayName()).toBe('Zen Free (OpenCode)');
    expect(mod.ZenFreeProvider.requiresApiKey()).toBe(true);
  });

  it('should report no key and empty model by default (zero hardcodes)', () => {
    expect(mod.ZenFreeProvider.hasApiKey()).toBe(false);
    expect(mod.ZenFreeProvider.loadConfig()).toEqual({ model: undefined, apiKey: undefined });
  });

  it('should surface env config via loadConfig()/hasApiKey()', () => {
    process.env.OPENCODE_API_KEY = 'env-key';
    process.env.ZEN_FREE_MODEL = 'some-model-free';
    expect(mod.ZenFreeProvider.hasApiKey()).toBe(true);
    expect(mod.ZenFreeProvider.loadConfig()).toEqual({ model: 'some-model-free', apiKey: 'env-key' });
  });
});

describe('getZenConfig', () => {
  it('should default to empty model with no key', () => {
    expect(mod.getZenConfig()).toEqual({ apiKey: undefined, model: '' });
  });

  it('should prefer env over file config', async () => {
    await fs.mkdir(join(tmpDir, '.cycledesign'), { recursive: true });
    await fs.writeFile(
      join(tmpDir, '.cycledesign', 'zen-free.json'),
      JSON.stringify({ apiKey: 'file-key', model: 'file-model-free' })
    );
    expect(mod.getZenConfig()).toEqual({ apiKey: 'file-key', model: 'file-model-free' });

    process.env.OPENCODE_API_KEY = 'env-key';
    process.env.ZEN_FREE_MODEL = 'env-model-free';
    expect(mod.getZenConfig()).toEqual({ apiKey: 'env-key', model: 'env-model-free' });
  });

  it('should round-trip saveConfig through the file', async () => {
    mod.ZenFreeProvider.saveConfig({ apiKey: 'saved-key', model: 'saved-model-free' });
    await loadModule();
    expect(mod.getZenConfig()).toEqual({ apiKey: 'saved-key', model: 'saved-model-free' });
  });
});

describe('createZenDynamicHeaders', () => {
  it('should emit CLI-faithful session/request IDs', () => {
    const headers = mod.createZenDynamicHeaders();
    expect(headers['x-opencode-session']).toMatch(/^ses_[0-9a-f]{24}$/);
    expect(headers['x-opencode-request']).toMatch(/^prt_[0-9a-f]{24}$/);
  });

  it('should be fresh on every evaluation', () => {
    const first = mod.createZenDynamicHeaders();
    const second = mod.createZenDynamicHeaders();
    expect(first['x-opencode-session']).not.toBe(second['x-opencode-session']);
    expect(first['x-opencode-request']).not.toBe(second['x-opencode-request']);
  });
});

describe('ZenFreeProvider.listModels', () => {
  it('should serve only the live -free set and cache it', async () => {
    // `-free` match is case-sensitive: 'x-Free' must NOT match.
    const fetchMock = stubCatalogFetch(['a-free', 'b', 'c-free', '', 'x-Free']);
    const provider = new mod.ZenFreeProvider('k', 'a-free');

    expect(await provider.listModels()).toEqual([
      { id: 'a-free', name: 'a-free' },
      { id: 'c-free', name: 'c-free' },
    ]);
    // Second call serves the cache without refetching.
    expect(await provider.listModels()).toEqual([
      { id: 'a-free', name: 'a-free' },
      { id: 'c-free', name: 'c-free' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should return [] (not throw) when the catalog fetch fails cold', async () => {
    stubCatalogFetch([], false, 500);
    const provider = new mod.ZenFreeProvider('k', 'a-free');
    await expect(provider.listModels()).resolves.toEqual([]);
  });

  it('should return [] for a malformed catalog body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: null }), { status: 200 })));
    const provider = new mod.ZenFreeProvider('k', 'a-free');
    await expect(provider.listModels()).resolves.toEqual([]);
  });

  it('should bound the catalog probe with an abort signal', async () => {
    const fetchMock = stubCatalogFetch(['a-free']);
    const provider = new mod.ZenFreeProvider('k', 'a-free');
    await provider.listModels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('should serve stale data while a background refresh runs', async () => {
    const fetchMock = stubCatalogFetch(['old-free']);
    const provider = new mod.ZenFreeProvider('k', 'old-free');
    expect(await provider.listModels()).toEqual([{ id: 'old-free', name: 'old-free' }]);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: [{ id: 'new-free' }] }), { status: 200 }));
      // Stale list served immediately; refresh kicked off in the background.
      expect(await provider.listModels()).toEqual([{ id: 'old-free', name: 'old-free' }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ZenFreeProvider.complete error mapping', () => {
  // Subclass defined per-test (not at describe scope): `mod` is loaded in
  // beforeEach, so extending it at collection time would see undefined.
  // Overrides getModel to throw without touching the network.
  function makeThrowing(failure: unknown) {
    class ThrowingZen extends mod.ZenFreeProvider {
      protected getModel(): Promise<LanguageModel> {
        throw failure;
      }
    }
    return new ThrowingZen('test-key', 'some-model-free');
  }

  const msg = [{ role: 'user' as const, content: 'hi' }];

  it('should surface a readable missing-key error without a key', async () => {
    const provider = new mod.ZenFreeProvider();
    await expect(provider.complete(msg)).rejects.toThrow(/OPENCODE_API_KEY/);
  });

  it('should require an explicit model selection', async () => {
    const provider = new mod.ZenFreeProvider('test-key');
    await expect(provider.complete(msg)).rejects.toThrow(/No Zen Free model selected/);
  });

  it('should wrap 429s in FreeUsageLimitError (still a RateLimitError)', async () => {
    const provider = makeThrowing({ status: 429, message: 'too many requests' });
    const error = await provider.complete(msg).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(errMod.FreeUsageLimitError);
    expect(error).toBeInstanceOf(errMod.RateLimitError);
    expect((error as InstanceType<ErrorsModule['FreeUsageLimitError']>).retryAfterMs).toBe(60000);
    expect((error as Error).message).toMatch(/Zen Free usage limit reached/);
  });

  it('should wrap quota messages and honor numeric retryAfterMs', async () => {
    const provider = makeThrowing({ message: 'daily limit exceeded', retryAfterMs: 5000 });
    const error = (await provider.complete(msg).catch((e: unknown) => e)) as InstanceType<
      ErrorsModule['FreeUsageLimitError']
    >;
    expect(error).toBeInstanceOf(errMod.FreeUsageLimitError);
    expect(error.retryAfterMs).toBe(5000);
    expect(error.message).toMatch(/~5s/);
  });

  it('should parse retry-after response headers (seconds per HTTP spec)', async () => {
    const provider = makeThrowing({ status: 429, responseHeaders: { 'retry-after': '120' } });
    const error = (await provider.complete(msg).catch((e: unknown) => e)) as InstanceType<
      ErrorsModule['FreeUsageLimitError']
    >;
    expect(error.retryAfterMs).toBe(120000);
  });

  it('should pass FreeUsageLimitError through unwrapped', async () => {
    const original = new errMod.FreeUsageLimitError('already wrapped', 7000);
    const provider = makeThrowing(original);
    await expect(provider.complete(msg)).rejects.toBe(original);
  });

  it('should rethrow non-limit errors untouched', async () => {
    const original = new Error('boom');
    const provider = makeThrowing(original);
    await expect(provider.complete(msg)).rejects.toBe(original);
  });
});

describe('resolveZenTransport', () => {
  it('should route prefixes to the pi-parity transports', () => {
    expect(mod.resolveZenTransport('gpt-foo-free')).toBe('openai-responses');
    expect(mod.resolveZenTransport('claude-foo-free')).toBe('anthropic-messages');
    expect(mod.resolveZenTransport('qwen3-coder-free')).toBe('anthropic-messages');
    expect(mod.resolveZenTransport('qwen3.5-free')).toBe('anthropic-messages');
    expect(mod.resolveZenTransport('gemini-foo-free')).toBe('google-generative-ai');
    expect(mod.resolveZenTransport('deepseek-v4-flash-free')).toBe('openai-completions');
  });

  it('should be case-sensitive with no vendor-prefix stripping', () => {
    expect(mod.resolveZenTransport('GPT-foo')).toBe('openai-completions');
    expect(mod.resolveZenTransport('Claude-foo')).toBe('openai-completions');
    expect(mod.resolveZenTransport('GEMINI-foo')).toBe('openai-completions');
    expect(mod.resolveZenTransport('openai/gpt-foo')).toBe('openai-completions');
    expect(mod.resolveZenTransport('')).toBe('openai-completions');
  });

  it('should prefer gpt- when an ID matches multiple prefixes', () => {
    // Contrived overlap guard: precedence gpt- > rest.
    expect(mod.resolveZenTransport('gpt-claude-free')).toBe('openai-responses');
  });
});

describe('normalizeZenBase', () => {
  it('should keep the canonical base untouched', () => {
    expect(mod.normalizeZenBase(mod.ZEN_BASE_URL)).toBe('https://opencode.ai/zen/v1');
  });

  it('should strip slashes and transport suffixes then ensure …/v1', () => {
    expect(mod.normalizeZenBase('https://opencode.ai/zen/v1/')).toBe('https://opencode.ai/zen/v1');
    expect(mod.normalizeZenBase('https://opencode.ai/zen/v1/chat/completions')).toBe(
      'https://opencode.ai/zen/v1'
    );
    expect(mod.normalizeZenBase('https://opencode.ai/zen/v1/responses')).toBe(
      'https://opencode.ai/zen/v1'
    );
    expect(mod.normalizeZenBase('https://opencode.ai/zen/v1/messages')).toBe(
      'https://opencode.ai/zen/v1'
    );
    expect(mod.normalizeZenBase('https://opencode.ai/zen/v1/chat/completions/')).toBe(
      'https://opencode.ai/zen/v1'
    );
    expect(mod.normalizeZenBase('https://example.com/api')).toBe('https://example.com/api/v1');
  });
});

describe('ZenFreeProvider.getModel dispatch', () => {
  type ModelShape = {
    modelId: string;
    specificationVersion: string;
    config?: { headers?: () => Promise<Record<string, string>>; fetch?: unknown; baseURL?: unknown };
  };

  async function modelFor(id: string): Promise<ModelShape> {
    // Subclass per-call (not at describe scope): `mod` loads in beforeEach.
    class ExposedZen extends mod.ZenFreeProvider {
      exposeModel(): Promise<LanguageModel> {
        return (this as unknown as { getModel: () => Promise<LanguageModel> }).getModel();
      }
    }
    const provider = new ExposedZen('test-key', id);
    return (await provider.exposeModel()) as unknown as ModelShape;
  }

  it('should yield v2|v3 models that ToolLoopAgent accepts on every transport', async () => {
    const { ToolLoopAgent, stepCountIs } = await import('ai');
    for (const id of [
      'gpt-foo-free',
      'claude-foo-free',
      'qwen3-coder-free',
      'gemini-foo-free',
      'deepseek-v4-flash-free',
    ]) {
      const shape = await modelFor(id);
      expect(['v2', 'v3']).toContain(shape.specificationVersion);
      expect(() => new ToolLoopAgent({ model: shape as never, stopWhen: stepCountIs(1) })).not.toThrow();
    }
  });

  it('should send Bearer + CLI headers with fresh ses_/prt_ per request on every transport', async () => {
    for (const id of [
      'gpt-foo-free',
      'claude-foo-free',
      'gemini-foo-free',
      'deepseek-v4-flash-free',
    ]) {
      const shape = await modelFor(id);
      const staticHeaders = await shape.config?.headers?.();
      expect(staticHeaders?.['authorization'] ?? staticHeaders?.['Authorization']).toBe(
        'Bearer test-key'
      );
      expect(staticHeaders?.['x-opencode-client']).toBe('cli');
      expect(staticHeaders?.['x-opencode-project']).toBe('global');
      expect(staticHeaders?.['user-agent'] ?? staticHeaders?.['User-Agent']).toMatch(
        /^opencode\/1\.18\.18/
      );

      const seen: Array<{ init?: RequestInit }> = [];
      vi.stubGlobal(
        'fetch',
        (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          seen.push({ init });
          return new Response('{}', { status: 200 });
        }) as typeof fetch
      );
      const fetchFn = shape.config?.fetch as (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => Promise<Response>;
      expect(typeof fetchFn).toBe('function');
      await fetchFn('https://example.com/a', { headers: staticHeaders });
      await fetchFn('https://example.com/b', { headers: staticHeaders });
      const first = new Headers(seen[0].init?.headers);
      const second = new Headers(seen[1].init?.headers);
      expect(first.get('x-opencode-session')).toMatch(/^ses_[0-9a-f]{24}$/);
      expect(second.get('x-opencode-session')).toMatch(/^ses_[0-9a-f]{24}$/);
      expect(first.get('x-opencode-session')).not.toBe(second.get('x-opencode-session'));
      expect(first.get('x-opencode-request')).not.toBe(second.get('x-opencode-request'));
      expect(first.get('x-opencode-client')).toBe('cli');
      vi.unstubAllGlobals();
    }
  });
});

describe('provider-factory zen-free dispatch', () => {
  it("should return ZenFreeProvider when provider-config selects 'zen-free'", async () => {
    vi.resetModules();
    const dir = join(tmpDir, '.cycledesign');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'provider-config.json'), JSON.stringify({ provider: 'zen-free' }));
    // Fresh copies post-reset: factory and provider must come from the same
    // module graph or instanceof checks see different class identities.
    const factory = await import('./provider-factory.js');
    const zen = await import('./zen-free.js');
    factory.clearProviderCache();
    expect(factory.getLLMProvider()).toBeInstanceOf(zen.ZenFreeProvider);
    factory.clearProviderCache();
  });
});
