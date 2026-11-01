import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'delay-reasons.spec.ts', workers: 1, retries: 0, timeout: 180000,
  use: { baseURL: process.env.DELAY_TEST_BASE_URL ?? 'http://127.0.0.1:15173', channel: process.env.DELAY_TEST_BROWSER ?? 'msedge' },
  reporter: [['list']], outputDir: '../../test-results/delay-reasons',
});
