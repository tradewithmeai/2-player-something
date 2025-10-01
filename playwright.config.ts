import { defineConfig, devices } from '@playwright/test'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: false, // Sequential to avoid port conflicts
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: 1, // Single worker to avoid port conflicts
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'list',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:5184',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Headless mode for CI */
    headless: true,
    /* Browser viewport */
    viewport: { width: 1280, height: 720 }
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ],

  /* Servers are started manually - comment out for now
  webServer: [
    {
      command: 'pnpm dev:frontend',
      port: 5184,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      command: process.env.MATCH_MODE === 'simul' 
        ? 'cmd /c "set MATCH_MODE=simul && set SIMUL_WINDOW_MS=500 && set SIMUL_STARTER_ALTERNATION=true && pnpm dev:server"'
        : 'cmd /c "set MATCH_MODE=turn && pnpm dev:server"',
      port: 8890,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  ],
  */

  /* Test timeout */
  timeout: 60000,
  /* Expect timeout */
  expect: {
    timeout: 10000
  }
})