// Cladding · vitest config — TS-native unit tests
//
// Tests live under `tests/` and mirror the source tree
// (`tests/spec/`, `tests/stages/`). Vitest's ESM mode + tsx loader
// means no separate build step.

import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['stages/**/*.ts', 'spec/**/*.ts'],
      exclude: ['stages/**/*.test.ts', 'conformance/**', '**/cli.ts'],
    },
  },
});
