import { defineConfig, devices } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getPorts } = require('../../scripts/ports.cjs') as {
  getPorts: (options?: { e2e?: boolean }) => { web: number; server: number; preview: number };
};

// E2E-owned ports (issue #76): base + local checkout offset + E2E offset.
// These never overlap manual `npm run dev` ports, so a Playwright-spawned
// stack can neither kill nor be killed by manual dev servers.
const ports = getPorts({ e2e: true });
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${ports.web}`;

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// dotenv.config({ path: '.env' });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev servers before starting the tests.
   * `dev:e2e` boots the E2E-offset stack WITHOUT touching manual dev ports
   * (it only ever kills E2E ports). With reuseExistingServer, healthy E2E
   * servers are reused and nothing is spawned or killed. */
  webServer: {
    command: 'cd ../.. && npm run dev:e2e',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stderr: 'pipe',
    stdout: 'pipe',
    env: {
      ENABLE_MOCK_PROVIDER: 'true',
    },
  },
});
