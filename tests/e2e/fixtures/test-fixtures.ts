import { test as base, expect, type Page } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getPorts } = require('../../../scripts/ports.cjs') as {
  getPorts: (options?: { e2e?: boolean }) => { web: number; server: number; preview: number };
};

/**
 * Extended test fixtures for CycleDesign E2E tests
 */
type TestFixtures = {
  authenticatedPage: Page;
  createSession: () => Promise<void>;
  useMockProvider: () => Promise<void>;
};

export const test = base.extend<TestFixtures>({
  /**
   * Authenticated page fixture - ensures the app is loaded and ready
   * For now, we assume OAuth is either completed or not required for basic UI tests
   */
  authenticatedPage: async ({ page }, use) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for the app to be hydrated (check for main elements)
    await page.waitForSelector('[data-testid="app-layout"]', { timeout: 15000 });

    await use(page);
  },

  /**
   * Helper to create a session
   * Note: This app manages sessions via localStorage, not URL routing
   */
  createSession: async ({ authenticatedPage }, use) => {
    const createSession = async (): Promise<void> => {
      // Click creates session directly (no dialog in original behavior)
      await authenticatedPage.getByTestId('new-session-button').click();

      // Wait for session select to have a value (session was created and selected)
      // MUI Select renders a div with role="combobox", not a native select element
      await authenticatedPage.waitForFunction(() => {
        const combobox = document.querySelector('[data-testid="session-select"] [role="combobox"]');
        return combobox && combobox.textContent && combobox.textContent.trim() !== '';
      }, { timeout: 5000 });
    };

    await use(createSession);
  },

  /**
   * Fixture to switch to mock provider for deterministic E2E tests.
   *
   * Selects mock headlessly via tRPC `providerConfig.updateConfig` and
   * asserts server truth (`getConfig` + `listModels`) before returning.
   * Throws on mismatch so tests fail fast instead of silently chatting
   * against a real provider. Must be called before any chat assertion —
   * a cold Qwen boot triggers the device-auth flow.
   */
  useMockProvider: async ({ page }, use) => {
    const selectMockProvider = async (): Promise<void> => {
      const { server } = getPorts({ e2e: true });
      const base = `http://localhost:${server}/trpc`;

      // NOTE: tRPC v11 batch POST bodies carry raw input per index
      // ({"0": {...}}), NOT the {"0": {"json": ...}} envelope used for GET
      // query-string inputs. The {"json": ...} wrapper here yields input {}
      // and a silent no-op, so tests would chat against Qwen while
      // attributed to mock. Verified against live E2E server responses.
      const updateRes = await page.request.post(
        `${base}/providerConfig.updateConfig?batch=1`,
        {
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify({ '0': { provider: 'mock' } }),
        }
      );
      if (!updateRes.ok()) {
        throw new Error(`useMockProvider: updateConfig failed with status ${updateRes.status()}`);
      }

      const emptyInput = encodeURIComponent(JSON.stringify({ '0': { json: null } }));

      const configRes = await page.request.get(
        `${base}/providerConfig.getConfig?batch=1&input=${emptyInput}`
      );
      if (!configRes.ok()) {
        throw new Error(`useMockProvider: getConfig failed with status ${configRes.status()}`);
      }
      // NOTE: responses are {"result": {"data": <output>}} — no nested
      // "json" envelope with the default transformer.
      const configJson = (await configRes.json() as Array<{ result?: { data?: { provider?: string } } }>)?.[0]?.result?.data;
      if (configJson?.provider !== 'mock') {
        throw new Error(`useMockProvider: expected getConfig().provider 'mock', got '${configJson?.provider}'`);
      }

      const modelsRes = await page.request.get(
        `${base}/providerConfig.listModels?batch=1&input=${emptyInput}`
      );
      if (!modelsRes.ok()) {
        throw new Error(`useMockProvider: listModels failed with status ${modelsRes.status()}`);
      }
      const models = (await modelsRes.json() as Array<{ result?: { data?: Array<{ id?: string }> } }>)?.[0]?.result?.data;
      if (!Array.isArray(models) || !models.some((m) => m?.id === 'mock-model')) {
        throw new Error(`useMockProvider: expected listModels() to contain 'mock-model', got '${JSON.stringify(models)}'`);
      }
    };

    await use(selectMockProvider);
  },
});

export { expect };
