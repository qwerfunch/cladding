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
      // v0.2.16 — source tree consolidated under src/. Each top-level
      // module dir kept its name; only the parent path changed.
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', 'conformance/**', 'src/spec/cli.ts'],
    },
  },
});
