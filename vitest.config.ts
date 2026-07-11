// Cladding · vitest config — TS-native unit tests
//
// Tests live under `tests/` and mirror the source tree
// (`tests/spec/`, `tests/stages/`). Vitest's ESM mode + tsx loader
// means no separate build step.

import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Emit a JUnit report alongside the console output so cladding's own
    // UNVERIFIED_AC detector can VERIFY (not just existence-check) that each
    // done AC's test_refs actually ran and passed — closing the self-gate's
    // AC→test→observed-pass loop (cladding dogfoods its own JUnit feature). The
    // path is a DEFAULT_REPORT_CANDIDATE the detector auto-discovers; it lives
    // under .cladding/ (gitignored) so it never pollutes git status. In CI
    // `npm test` runs before `clad check`, so the gate reads a fresh, complete
    // report; standalone `clad check` reads the prior run's (the documented
    // degrade-to-existence baseline applies when no report is present yet).
    reporters: ['default', ['junit', {outputFile: '.cladding/test-report.junit.xml'}]],
    // The heavy scenario suites (init + observed-path scan over the 8-file
    // fixtures, then detector snapshots) run ~6s locally but several × slower
    // under the 2-core GitHub runner's worker contention. The default 5s
    // timeout starves them there (green locally, red on CI). Give every test
    // generous headroom; the genuinely-heaviest one sets its own 60s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
