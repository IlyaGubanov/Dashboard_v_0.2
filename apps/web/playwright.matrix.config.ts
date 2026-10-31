import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'matrix.spec.ts', workers: 1, retries: 0, timeout: 180000,
  use: { baseURL: process.env.MATRIX_TEST_BASE_URL ?? 'http://127.0.0.1:15173', channel: process.env.MATRIX_TEST_BROWSER || undefined },
  reporter: [['list']], outputDir: process.env.MATRIX_TEST_OUTPUT ?? '../../test-results/matrix',
});
