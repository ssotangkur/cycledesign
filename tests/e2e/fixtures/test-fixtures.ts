import { test as base, expect, type Page } from '@playwright/test';

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
   * Fixture to switch to mock provider for deterministic E2E tests
   * Sets localStorage and reloads the page to apply the provider change
   */
  useMockProvider: async ({ page }, use) => {
    // Switch to mock provider via localStorage
    await page.evaluate(() => {
      localStorage.setItem('cycledesign:provider', 'mock');
    });

    // Reload to apply provider change
    await page.reload();
    await page.waitForSelector('[data-testid="app-layout"]', { timeout: 15000 });

    // Provide a no-op function as the fixture value
    await use(async () => {});
  },
});

export { expect };
