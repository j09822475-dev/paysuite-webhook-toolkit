import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/fixtures.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
    typecheck: {
      enabled: false,
      include: ['tests/tsd/**/*.test-d.ts'],
    },
  },
});
