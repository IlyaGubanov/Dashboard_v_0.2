import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'video.spec.ts', workers: 1, retries: 0, timeout: 45000,
  use: { baseURL: process.env.VIDEO_TEST_BASE_URL ?? 'http://127.0.0.1:18080', channel: process.env.VIDEO_TEST_BROWSER || undefined, viewport: { width: 1440, height: 1100 } },
  reporter: [['list']], outputDir: '../../test-results/video',
});
