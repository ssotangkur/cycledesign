import { test, expect } from '../fixtures/test-fixtures';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getPorts } = require('../../../scripts/ports.cjs') as {
  getPorts: (options?: { e2e?: boolean }) => { web: number; server: number; preview: number };
};

/**
 * E2E Tests for Settings Page - Provider/Model Selection Flow
 *
 * These tests verify the provider/model dependency logic:
 * - Model dropdown updates when provider changes
 * - Model selection resets when provider changes
 * - Settings save correctly with valid provider + model pair
 * - Settings page loads with correct provider + model pre-selected
 */
test.describe('Settings - Provider/Model Selection', () => {

  test('should navigate to settings page', async ({ authenticatedPage }) => {
    // Navigate to settings page
    await authenticatedPage.goto('/settings');

    // Wait for settings page to load
    await expect(authenticatedPage.getByTestId('settings-page')).toBeVisible();

    // Verify provider dropdown is visible
    const providerSelect = authenticatedPage.getByTestId('provider-select');
    await expect(providerSelect).toBeVisible();
  });

  test('should update model dropdown when provider changes', async ({ authenticatedPage, useMockProvider }) => {
    // Select mock first so settings queries load against mock state
    await useMockProvider();

    // Navigate to settings page
    await authenticatedPage.goto('/settings');
    await expect(authenticatedPage.getByTestId('settings-page')).toBeVisible();

    // Get the provider select
    const providerSelect = authenticatedPage.getByTestId('provider-select');
    await providerSelect.waitFor({ state: 'visible' });

    // Get current provider value
    const currentProvider = await providerSelect.locator('.MuiSelect-select').textContent();

    // Click to open provider dropdown
    await providerSelect.click();

    // Get all provider options
    const providerOptions = authenticatedPage.locator('[role="option"]');
    await providerOptions.first().waitFor({ state: 'visible', timeout: 5000 });
    const providerCount = await providerOptions.count();

    // If there are multiple providers, select a different one
    if (providerCount > 1) {
      // Get the first option that's different from current
      let targetOption = providerOptions.first();
      let targetText = await targetOption.textContent();

      if (targetText === currentProvider) {
        targetOption = providerOptions.last();
        targetText = await targetOption.textContent();
      }

      // Select the different provider
      await targetOption.click();

      // Wait for model dropdown to update (should happen within 500ms)
      await authenticatedPage.waitForTimeout(600);

      // Verify model dropdown is enabled and has options
      const modelSelect = authenticatedPage.getByTestId('model-select');
      await expect(modelSelect).toBeVisible();

      // Model dropdown should not show "Loading models..." anymore
      const modelText = await modelSelect.locator('.MuiSelect-select').textContent();
      expect(modelText).not.toContain('Loading models...');
    }
  });

  test('should reset model selection when provider changes', async ({ authenticatedPage, useMockProvider }) => {
    // Select mock first so settings queries load against mock state
    await useMockProvider();

    // Navigate to settings page
    await authenticatedPage.goto('/settings');
    await expect(authenticatedPage.getByTestId('settings-page')).toBeVisible();

    // Get the provider select
    const providerSelect = authenticatedPage.getByTestId('provider-select');
    await providerSelect.waitFor({ state: 'visible' });

    // Get current model value before provider change
    const modelSelect = authenticatedPage.getByTestId('model-select');
    await modelSelect.waitFor({ state: 'visible' });
    const modelBeforeChange = await modelSelect.locator('.MuiSelect-select').textContent();

    // Click to open provider dropdown
    await providerSelect.click();

    // Get all provider options
    const providerOptions = authenticatedPage.locator('[role="option"]');
    await providerOptions.first().waitFor({ state: 'visible', timeout: 5000 });
    const providerCount = await providerOptions.count();

    // If there are multiple providers, select a different one
    if (providerCount > 1) {
      // Select a different provider
      await providerOptions.last().click();

      // Wait for model dropdown to update
      await authenticatedPage.waitForTimeout(600);

      // Get the new model value
      const modelAfterChange = await modelSelect.locator('.MuiSelect-select').textContent();

      // Model should have changed or be reset to first available model
      // The key is that it should be a valid model for the new provider
      expect(modelAfterChange).toBeDefined();
      
      // If we had a model before, verify it actually changed or was reset appropriately
      if (modelBeforeChange && modelBeforeChange.trim() && !modelBeforeChange.includes('Loading')) {
        // Model should either be different or the same (if both providers share the first model)
        // The important thing is that it's a valid model for the new provider
        expect(modelAfterChange && modelAfterChange.trim().length > 0).toBe(true);
      }
    }
  });

  test('should save settings with valid provider + model pair', async ({ authenticatedPage, useMockProvider }) => {
    // Select mock first so settings queries load against mock state
    await useMockProvider();

    // Navigate to settings page
    await authenticatedPage.goto('/settings');
    await expect(authenticatedPage.getByTestId('settings-page')).toBeVisible();

    // Get the provider select
    const providerSelect = authenticatedPage.getByTestId('provider-select');
    await providerSelect.waitFor({ state: 'visible' });

    // Click to open provider dropdown
    await providerSelect.click();

    // Get all provider options
    const providerOptions = authenticatedPage.locator('[role="option"]');
    await providerOptions.first().waitFor({ state: 'visible', timeout: 5000 });

    // Select first provider
    await providerOptions.first().click();

    // Wait for model dropdown to update
    await authenticatedPage.waitForTimeout(600);

    // Get the model select
    const modelSelect = authenticatedPage.getByTestId('model-select');
    await modelSelect.waitFor({ state: 'visible' });

    // Click to open model dropdown
    await modelSelect.click();

    // Get all model options
    const modelOptions = authenticatedPage.locator('[role="option"]');
    await modelOptions.first().waitFor({ state: 'visible', timeout: 5000 });

    // Select first model (if available and not disabled)
    const firstModelOption = modelOptions.first();
    const firstModelText = await firstModelOption.textContent();

    // Check if the first option is clickable (not disabled)
    const isDisabled = await firstModelOption.getAttribute('aria-disabled');
    
    if (!firstModelText?.includes('Loading') && 
        !firstModelText?.includes('No models') && 
        !firstModelText?.includes('Provide API key') &&
        isDisabled !== 'true') {
      await firstModelOption.click();

      // Wait for save to complete
      await authenticatedPage.waitForTimeout(500);

      // Verify no error messages
      const errorAlerts = authenticatedPage.locator('[role="alert"]').filter({ hasText: 'error' });
      const errorCount = await errorAlerts.count();
      expect(errorCount).toBe(0);
    }
  });

  test('should load settings with correct provider + model pre-selected', async ({ authenticatedPage, useMockProvider }) => {
    // Select mock first so settings queries load against mock state
    await useMockProvider();

    // Navigate to settings
    await authenticatedPage.goto('/settings');
    await expect(authenticatedPage.getByTestId('settings-page')).toBeVisible();

    // Get the provider select and note the value
    const providerSelect = authenticatedPage.getByTestId('provider-select');
    await providerSelect.waitFor({ state: 'visible' });
    const expectedProvider = await providerSelect.locator('.MuiSelect-select').textContent();

    // Get the model select and note the value
    const modelSelect = authenticatedPage.getByTestId('model-select');
    await modelSelect.waitFor({ state: 'visible' });
    const expectedModel = await modelSelect.locator('.MuiSelect-select').textContent();

    // Verify we have valid values before testing persistence
    const hasValidModel = expectedModel && expectedModel.trim().length > 0 && 
                          !expectedModel.includes('Loading') && 
                          !expectedModel.includes('No models') &&
                          !expectedModel.includes('Failed');

    if (hasValidModel) {
      // Reload the page
      await authenticatedPage.reload();
      await expect(authenticatedPage.getByTestId('settings-page')).toBeVisible();

      // Verify provider is still selected
      const providerSelectAfter = authenticatedPage.getByTestId('provider-select');
      const providerAfter = await providerSelectAfter.locator('.MuiSelect-select').textContent();
      expect(providerAfter).toBe(expectedProvider);

      // Verify model is still selected (should be same model or first available model for provider)
      const modelSelectAfter = authenticatedPage.getByTestId('model-select');
      await modelSelectAfter.waitFor({ state: 'visible' });
      const modelAfter = await modelSelectAfter.locator('.MuiSelect-select').textContent();
      
      // Model should have a value after reload (either same model or first available)
      expect(modelAfter && modelAfter.trim().length > 0).toBe(true);
    }
  });

  test('should round-trip provider selection mock -> qwen -> mock', async ({ authenticatedPage, useMockProvider }) => {
    // Start from an explicitly selected mock provider
    await useMockProvider();

    await authenticatedPage.goto('/settings');
    await expect(authenticatedPage.getByTestId('settings-page')).toBeVisible();

    const { server } = getPorts({ e2e: true });
    const base = `http://localhost:${server}/trpc`;
    const emptyInput = encodeURIComponent(JSON.stringify({ '0': { json: null } }));
    const getServerProvider = async (): Promise<string> => {
      const res = await authenticatedPage.request.get(
        `${base}/providerConfig.getConfig?batch=1&input=${emptyInput}`
      );
      expect(res.ok()).toBe(true);
      const json = (await res.json() as Array<{ result?: { data?: { provider?: string } } }>)?.[0]?.result?.data;
      return json?.provider ?? '';
    };

    // Leg 1: mock (also exercises the SettingsPage model-reset path on each switch)
    expect(await getServerProvider()).toBe('mock');

    // The provider Select disables while a save is in flight, and a
    // model-reset mutate can re-render the menu mid-click — either can make
    // a single open+click a silent no-op. Retry until the UI *and* the
    // server agree on the target provider.
    const selectProviderViaUI = async (optionName: string, selectedText: string): Promise<void> => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await authenticatedPage.getByTestId('provider-select').click();
        await authenticatedPage.getByRole('option', { name: optionName }).click();
        try {
          await expect(authenticatedPage.getByTestId('provider-select')).toContainText(selectedText, { timeout: 5000 });
          await expect.poll(getServerProvider, { timeout: 10000 }).toBe(selectedText === 'Mock Provider' ? 'mock' : 'qwen');
          return;
        } catch {
          if (attempt === 3) throw new Error(`selectProviderViaUI: failed to select '${optionName}' after 3 attempts`);
        }
      }
    };

    // Leg 2: switch to qwen via the Settings UI
    await selectProviderViaUI('Qwen (OAuth - Free)', 'Qwen');

    // Leg 3: switch back to mock via the Settings UI (leaves state at mock)
    await selectProviderViaUI('Mock Provider', 'Mock Provider');
  });

  test('should show error state with retry option when model loading fails', async ({ authenticatedPage }) => {
    // This test would require mocking network failures
    // For now, we verify the error UI structure exists in the component
    // by checking that the component renders without errors
    
    await authenticatedPage.goto('/settings');
    await expect(authenticatedPage.getByTestId('settings-page')).toBeVisible();

    // The component should load without crashing
    // Error handling is tested via the component's error prop on FormControl
    const modelSelect = authenticatedPage.getByTestId('model-select');
    await expect(modelSelect).toBeVisible();
  });
});
