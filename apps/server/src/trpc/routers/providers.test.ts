import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let cwdSpy: { mockRestore: () => void };
const savedEnv: Record<string, string | undefined> = {};

type ProvidersModule = typeof import('./providers.js');
let mod: ProvidersModule;

async function loadRouter() {
  vi.resetModules();
  mod = await import('./providers.js');
  return mod.providersRouter.createCaller({});
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'cycledesign-providers-test-'));
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  for (const key of ['ENABLE_MOCK_PROVIDER', 'CYCLEDESIGN_CONFIG_DIR', 'CYCLEDESIGN_E2E']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(async () => {
  for (const key of ['ENABLE_MOCK_PROVIDER', 'CYCLEDESIGN_CONFIG_DIR', 'CYCLEDESIGN_E2E']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  cwdSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('providers router without ENABLE_MOCK_PROVIDER', () => {
  it('boots to the default provider, not mock', async () => {
    const caller = await loadRouter();
    const config = await caller.getConfig();
    expect(config.provider).toBe('qwen');
  });

  it('omits mock from the provider list', async () => {
    const caller = await loadRouter();
    const list = await caller.list();
    expect(list.map((p) => p.name)).not.toContain('mock');
  });

  it('treats updateConfig({ provider: "mock" }) as a silent no-op', async () => {
    const caller = await loadRouter();
    const before = await caller.getConfig();
    await caller.updateConfig({ provider: 'mock' });
    const after = await caller.getConfig();
    expect(after.provider).toBe(before.provider);
  });

  it('writes no config file on unknown-provider no-op', async () => {
    const caller = await loadRouter();
    await caller.updateConfig({ provider: 'mock' });
    expect(existsSync(join(tmpDir, '.cycledesign', 'provider-config.json'))).toBe(false);
    expect(existsSync(join(tmpDir, '.cycledesign-e2e'))).toBe(false);
  });
});

describe('providers router with ENABLE_MOCK_PROVIDER=true', () => {  beforeEach(() => {
    process.env.ENABLE_MOCK_PROVIDER = 'true';
  });

  it('boots to file/default instead of force-defaulting to mock', async () => {
    const caller = await loadRouter();
    const config = await caller.getConfig();
    expect(config.provider).toBe('qwen');
  });

  it('lists mock as available', async () => {
    const caller = await loadRouter();
    const list = await caller.list();
    expect(list.map((p) => p.name)).toContain('mock');
  });

  it('selects mock explicitly via updateConfig with server truth', async () => {
    const caller = await loadRouter();
    await caller.updateConfig({ provider: 'mock' });
    const config = await caller.getConfig();
    expect(config.provider).toBe('mock');
    const models = await caller.listModels();
    expect(models.map((m) => m.id)).toContain('mock-model');
  });

  it('isolates provider config under .cycledesign-e2e when CYCLEDESIGN_E2E=1', async () => {
    process.env.CYCLEDESIGN_E2E = '1';
    const caller = await loadRouter();
    await caller.updateConfig({ provider: 'mock' });
    expect(existsSync(join(tmpDir, '.cycledesign-e2e', 'provider-config.json'))).toBe(true);
    expect(existsSync(join(tmpDir, '.cycledesign'))).toBe(false);
  });
});

describe('providers router local provider', () => {
  it('lists local as available', async () => {
    const caller = await loadRouter();
    const list = await caller.list();
    expect(list.map((p) => p.name)).toContain('local');
  });

  it('round-trips baseURL through updateConfig/getConfig with normalization', async () => {
    const caller = await loadRouter();
    await caller.updateConfig({
      provider: 'local',
      baseURL: 'http://localhost:1234/v1/chat/completions',
      model: 'qwen3:8b',
    });
    const config = await caller.getConfig();
    expect(config.provider).toBe('local');
    expect(config.baseURL).toBe('http://localhost:1234/v1');
    expect(config.model).toBe('qwen3:8b');
    // Second caller (fresh module state, same cwd) sees persisted values.
    const caller2 = await loadRouter();
    const config2 = await caller2.getConfig();
    expect(config2.baseURL).toBe('http://localhost:1234/v1');
    expect(config2.model).toBe('qwen3:8b');
  });

  it("never writes a literal 'default' model for local", async () => {
    const caller = await loadRouter();
    const result = await caller.updateConfig({ provider: 'local' });
    expect(result.model).not.toBe('default');
    const { readFileSync } = await import('node:fs');
    const localJson = join(tmpDir, '.cycledesign', 'local.json');
    if (existsSync(localJson)) {
      expect(readFileSync(localJson, 'utf-8')).not.toContain('"default"');
    }
  });
});
