import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    browserName: 'chromium',
    // Optionally test an installed Chrome or Edge: PLAYWRIGHT_CHANNEL=chrome bun run test:browser
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
