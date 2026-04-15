import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    globals: false,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    setupFiles: ['tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        // UI glue modules with heavy DOM wiring that's covered by e2e, not unit
        'src/popup/**',
        'src/review/review.ts',
        'src/review/redactor.ts',
        'src/options/**',
        'src/content/page-hook.ts',
        'src/background/full-page-capture.ts',
      ],
      thresholds: {
        // Overall project floor. Ratchet these upward as the test suite grows.
        lines: 75,
        statements: 75,
        functions: 75,
        branches: 70,
        // Per-file floors for the critical pure modules — a regression in any
        // one of these alone should fail CI even if overall coverage is fine.
        // Per-file floors set slightly below current measured values so
        // regressions fail CI. Ratchet upward as tests improve.
        'src/shared/zip.ts': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/shared/exporter.ts': { lines: 95, branches: 75, functions: 95, statements: 95 },
        'src/shared/trackers/common.ts': { lines: 70, branches: 70, functions: 85, statements: 70 },
        'src/content/d365-adapter.ts': { lines: 85, branches: 75, functions: 95, statements: 85 },
        'src/review/redactor-state.ts': { lines: 95, branches: 85, functions: 95, statements: 95 },
      },
    },
  },
});
