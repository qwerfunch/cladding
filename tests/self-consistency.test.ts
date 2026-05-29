// Cladding · self-consistency (dogfood) tests
//
// cladding is a drift-detection tool — it must not silently drift against
// ITSELF. A prior audit found exactly that "Vacuous Green" pattern: docs
// claimed "26 detectors" while the code shipped 27, and spec.yaml's
// project.version lagged a full minor behind package.json, with no check
// catching either. Those were hand-corrected; this suite locks the
// corrections as permanent, CI-enforced invariants so they cannot regress.
//
// These are cladding-SELF checks (they run against this repo's own files),
// NOT shipped detectors — a general adopting project may legitimately
// version its spec.yaml independently or mention "N detectors" in its own
// docs, so enforcing this on every project would false-fail. Keeping it as
// a self-test gives the reference implementation honesty without imposing
// it on adopters.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

import {allDetectors} from '../src/stages/detectors/index.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe('cladding self-consistency (no Vacuous Green against itself)', () => {
  test('prose detector-count claims match the actual detector count', () => {
    const actual = allDetectors.length;
    // Files whose prose states cladding's own detector count. Each is a
    // single, unambiguous claim of the form "<N> [drift ]detector(s)".
    const files = ['spec.yaml', 'docs/project-context.md', 'spec/capabilities.yaml', 'AGENTS.md'];
    for (const f of files) {
      const m = read(f).match(/(\d+)\s+(?:drift\s+)?detectors?\b/i);
      expect(m, `${f} should state a detector count`).not.toBeNull();
      expect(Number(m![1]), `${f} detector-count claim should equal allDetectors.length`).toBe(actual);
    }
  });

  test('spec.yaml project.version tracks package.json version', () => {
    const pkgVersion = (JSON.parse(read('package.json')) as {version: string}).version;
    const specVersion = read('spec.yaml').match(/^\s*version: "(\d+\.\d+\.\d+)"/m)?.[1];
    expect(specVersion, 'spec.yaml must declare project.version').toBeDefined();
    expect(specVersion).toBe(pkgVersion);
  });

  test('Tier A/B spec files carry the mandated first-line tier banner', () => {
    // docs/ssot-model.md §Header convention mandates a `# Cladding · Tier X`
    // banner as the first line of every managed artifact.
    expect(read('spec.yaml').split('\n')[0]).toMatch(/^#\s*Cladding\s*·\s*Tier A\b/);
    expect(read('spec/architecture.yaml').split('\n')[0]).toMatch(/^#\s*Cladding\s*·\s*Tier B\b/);
    expect(read('spec/capabilities.yaml').split('\n')[0]).toMatch(/^#\s*Cladding\s*·\s*Tier B\b/);
  });
});
