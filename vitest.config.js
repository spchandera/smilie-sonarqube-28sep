import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('./assets/', import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the import map in snippets/scripts.liquid
    alias: [{ find: /^@theme\/(.*)$/, replacement: `${assets}$1.js` }],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    // QR generation renders large DOM tables under jsdom
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['assets/**/*.js'],
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
