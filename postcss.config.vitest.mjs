import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
