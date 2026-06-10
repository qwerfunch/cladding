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

import {readFileSync, readdirSync} from 'node:fs';
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

describe('glossary is the terminology SSoT (F-7ce18e)', () => {
  // Every public name must carry a glossary row — a name the glossary does
  // not know is an unregistered term and fails here (AC-002). The glossary
  // documents names as `name` (backticked); presence of the backticked token
  // anywhere in the file counts as registered.
  const glossary = read('docs/glossary.md');
  const registered = (name: string): boolean => glossary.includes('`' + name + '`');

  test('every CLI verb registered in clad.ts has a glossary row', () => {
    const cli = read('src/cli/clad.ts');
    // commander registrations: .command('<verb> [args...]') — first word is the verb.
    const verbs = [...cli.matchAll(/\.command\('([a-z]+)[^']*'\)/g)].map((m) => m[1]);
    expect(verbs.length).toBeGreaterThanOrEqual(14);
    for (const v of new Set(verbs)) {
      expect(registered(v), `CLI verb '${v}' is missing from docs/glossary.md`).toBe(true);
    }
  });

  test('every persona file under src/agents/ has a glossary row', () => {
    const ids = readdirSync(join(ROOT, 'src/agents'))
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .map((f) => f.replace(/\.md$/, ''));
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) {
      expect(registered(id), `persona '${id}' is missing from docs/glossary.md`).toBe(true);
    }
  });

  test('every MCP tool registered in server.ts has a glossary row (frozen wire ids)', () => {
    const server = read('src/serve/server.ts');
    const tools = [...server.matchAll(/'(clad_[a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(tools).size).toBeGreaterThanOrEqual(8);
    for (const t of new Set(tools)) {
      expect(registered(t), `MCP tool '${t}' is missing from docs/glossary.md`).toBe(true);
    }
  });

  test('every event type has a glossary row (frozen wire ids)', () => {
    // Strip // comments BEFORE matching — the union's doc comments quote
    // payload values ('scan_artifacts' etc.) and contain semicolons that
    // would truncate a naive capture.
    const log = read('src/events/log.ts')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    const m = log.match(/export type EventType =([^;]+);/);
    expect(m).not.toBeNull();
    const types = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(types.length).toBeGreaterThanOrEqual(9);
    for (const t of types) {
      expect(registered(t), `event type '${t}' is missing from docs/glossary.md`).toBe(true);
    }
  });

  test('deprecated aliases are documented as aliases pointing at their replacement', () => {
    for (const [oldName, newName] of [
      ['librarian', 'planner'],
      ['specialists', 'developer'],
      ['refine', 'clarify'],
      ['panel', 'status'],
      ['drive', 'run'],
    ]) {
      const row = glossary.split('\n').find((l) => l.includes('`' + oldName + '`') && l.includes('alias'));
      expect(row, `'${oldName}' must have an alias row`).toBeDefined();
      expect(row, `'${oldName}' alias row must name '${newName}'`).toContain('`' + newName + '`');
    }
  });
});
