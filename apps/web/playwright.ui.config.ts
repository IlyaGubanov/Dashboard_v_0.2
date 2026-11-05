import { defineConfig } from '@playwright/test';

const baseURL = process.env.UI_TEST_BASE_URL ?? 'http://127.0.0.1:5265';
if (!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('UX-проверки разрешены только на локальной тестовой копии');

export default defineConfig({
  testDir: './e2e', testMatch: 'ui-ux.spec.ts', workers: 1, retries: 0, timeout: 45000,
  use: { baseURL, channel: process.env.UI_TEST_BROWSER || 'msedge', viewport: { width: 375, height: 812 }, colorScheme: 'light' },
  reporter: [['list']], outputDir: '../../test-results/ui',
});
