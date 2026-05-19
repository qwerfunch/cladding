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
      // v0.2.13 widens the coverage scope from {stages, spec} to every
      // first-party source dir cladding ships. The narrow v0.2.12 scope
      // measured stages + spec only; the wider scope counts cli/, drive/,
      // optimizer/, adapters/, router/, ui/, hitl/, events/, agents/.
      // Coverage numbers from v0.2.13 onward are not directly comparable
      // to pre-v0.2.13 percentages.
      include: [
        'stages/**/*.ts',
        'spec/**/*.ts',
        'cli/**/*.ts',
        'drive/**/*.ts',
        'optimizer/**/*.ts',
        'adapters/**/*.ts',
        'router/**/*.ts',
        'ui/**/*.ts',
        'hitl/**/*.ts',
        'events/**/*.ts',
        'agents/**/*.ts',
      ],
      exclude: ['**/*.test.ts', 'conformance/**', 'spec/cli.ts'],
    },
  },
});
