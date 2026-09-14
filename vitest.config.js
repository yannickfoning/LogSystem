import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    // Disable parallel execution for integration tests to avoid schema conflicts
    pool: 'forks',
    singleFork: true,
    // Global setup for database schema initialization
    globalSetup: './tests/globalSetup.js',
  },
});
