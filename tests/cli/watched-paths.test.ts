// Cladding · watched-path filter derives from the language SSoT (F-63b989e5)
//
// The impact card must fire for EVERY language cladding claims — .tsx included —
// not just the legacy 5-extension set. `isWatchedSourcePath` is private, so the
// honest way to test the predicate is to drive `runHookEvent('PostToolUse', …)`
// and observe the ONE oracle it cannot fake: runDrift is called if and only if
// the edit passes the watched gate (write tool ∧ isWatchedSourcePath ∧ under
// cladding ∧ not debounced). We fix the first, third, and fourth conjuncts, so
// `driftStub` called ⟺ isWatchedSourcePath(path) === true.
//
// The extension SSoT itself — WATCHED_EXTENSIONS — is imported directly for the
// membership + import-path pins (AC-2) and the O(1) perf pin (AC-4).

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {extname, join} from 'node:path';
import {performance} from 'node:perf_hooks';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {WATCHED_EXTENSIONS} from '../../src/stages/toolchain/language-config.js';

type StageResult = {pass: boolean; exitCode: number; stderr?: string};
type DriftFinding = {detector: string; severity: 'error' | 'warn' | 'info'; path?: string; message: string};
type DriftReport = StageResult & {findings: DriftFinding[]};

const STAGE_PASS: StageResult = {pass: true, exitCode: 0};
const DRIFT_CLEAN: DriftReport = {pass: true, exitCode: 0, findings: []};

// Same stub trio as hook.test.ts — runDrift is the watched-gate oracle.
const driftStub = vi.fn((): DriftReport => DRIFT_CLEAN);
vi.mock('../../src/stages/drift.js', () => ({runDrift: (...a: unknown[]) => driftStub(...(a as []))}));
vi.mock('../../src/stages/arch.js', () => ({runArch: (): StageResult => STAGE_PASS}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: (): StageResult => STAGE_PASS}));

const {runHookEvent} = await import('../../src/cli/hook.js');

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-watched-'));
  // Minimal cladding presence: the watched gate only needs spec.yaml to exist
  // (a trivial edit never reaches loadSpec), so counts/content are irrelevant.
  writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n', 'utf8');
  driftStub.mockImplementation(() => DRIFT_CLEAN);
});

afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
  vi.clearAllMocks();
});

/**
 * True iff the watched-path gate admits `filePath`. Drives a TRIVIAL Edit (so the
 * card machinery is skipped and only the gate runs) and reads the driftStub oracle.
 * Debounce state is cleared each call so every path is judged independently.
 */
function watched(filePath: string): boolean {
  rmSync(join(cwd, '.cladding'), {recursive: true, force: true}); // clear debounce stamp
  driftStub.mockClear();
  runHookEvent('PostToolUse', {tool_name: 'Edit', tool_input: {file_path: filePath, new_string: 'x'}}, cwd);
  return driftStub.mock.calls.length > 0;
}

// --- AC-1 (AC-faae7baf) — real-world layouts: sources watched, artifacts not ---

interface Corpus {
  readonly name: string;
  readonly sources: readonly string[]; // expect watched === true
  readonly nonSources: readonly string[]; // expect watched === false
}

const CORPORA: readonly Corpus[] = [
  {
    name: 'cladding-like TypeScript repo',
    sources: ['src/cli/hook.ts', 'src/ui/Card.tsx', 'tests/cli/watched-paths.test.ts'],
    nonSources: ['package.json', 'README.md', 'tsconfig.json'],
  },
  {
    // app/src/main/kotlin/… is watched via the src/-segment rule; build.gradle.kts
    // is watched via the .kts extension (NOT src) — the task's ".kts IS watched".
    name: 'Gradle multi-module Kotlin',
    sources: [
      'app/src/main/kotlin/com/acme/App.kt',
      'core/src/test/kotlin/com/acme/CoreTest.kt',
      'build.gradle.kts',
    ],
    nonSources: ['build.gradle', 'settings.gradle', 'gradle.properties'],
  },
  {
    // .rb is watched by extension; .rake is NOT in the set → false outside src/.
    name: 'Rails layout',
    sources: ['app/models/user.rb', 'app/controllers/users_controller.rb', 'lib/parser.rb'],
    nonSources: ['lib/tasks/import.rake', 'Gemfile', 'Gemfile.lock', 'config/database.yml'],
  },
  {
    // The headline regression: app/page.tsx OUTSIDE src/ MUST be watched now.
    name: 'Next.js app-router',
    sources: ['app/page.tsx', 'components/Button.jsx', 'middleware.mts', 'app/layout.tsx', 'lib/db.ts'],
    nonSources: ['package.json', 'README.md', 'tsconfig.json', '.env'],
  },
  {
    // .cs and .fs (F#) watched by extension.
    name: '.NET solution',
    sources: ['MyApp/Program.cs', 'MyApp.Tests/UserTest.fs', 'src/Domain/User.cs'],
    nonSources: ['MyApp/MyApp.csproj', 'MyApp.sln', 'global.json', 'nuget.config'],
  },
];

describe.each(CORPORA)('AC-1 · $name — recall on sources, silence on artifacts', (corpus) => {
  test.each(corpus.sources)('source %s → watched', (path) => {
    expect(watched(path)).toBe(true);
  });
  test.each(corpus.nonSources)('artifact %s → skipped', (path) => {
    expect(watched(path)).toBe(false);
  });
});

// Every extension the shard NAMES must resolve true, outside src/ (isolates the
// extension arm from the src/-segment rule). Includes .ex/.exs/.php/.java/.py/.rs/.go.
const IN_SET_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.kt',
  '.kts',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.rb',
  '.php',
  '.cs',
  '.fs',
  '.ex',
  '.exs',
] as const;

describe('AC-1 · extension recall (outside src/, so only the extension arm can match)', () => {
  test.each(IN_SET_EXTENSIONS)('a bare %s file is watched', (ext) => {
    expect(watched(`pkg/module${ext}`)).toBe(true);
  });

  test('[covers:F-63b989e5/AC-faae7baf] every registered watched extension is accepted outside the src path rule', () => {
    for (const ext of IN_SET_EXTENSIONS) expect(watched(`pkg/module${ext}`)).toBe(true);
  });

  test('extension match is case-insensitive (extname is lowercased)', () => {
    expect(watched('pkg/App.TSX')).toBe(true);
    expect(watched('pkg/Program.CS')).toBe(true);
    expect(watched('pkg/Mixfile.EX')).toBe(true);
  });
});

// --- AC-3 (AC-25c3a256) — non-source artifacts stay silent outside src/ ---

// The set contains .mts/.cts but deliberately NOT .mjs/.cjs, and NOT .rake —
// pinning current behavior (a future widening of the set must revisit this test).
const OUT_OF_SET_EXTENSIONS = [
  '.md',
  '.yaml',
  '.yml',
  '.json',
  '.lock',
  '.mjs',
  '.cjs',
  '.rake',
  '.gradle',
  '.properties',
  '.txt',
] as const;

describe('AC-3 · non-source artifacts are NOT watched (outside src/)', () => {
  test.each(OUT_OF_SET_EXTENSIONS)('a bare %s file is skipped', (ext) => {
    expect(watched(`config/thing${ext}`)).toBe(false);
  });

  test('[covers:F-63b989e5/AC-25c3a256] configuration and documentation extensions remain outside the watched source set', () => {
    for (const ext of OUT_OF_SET_EXTENSIONS) expect(watched(`config/thing${ext}`)).toBe(false);
  });

  test('extension-less build/meta files are skipped', () => {
    expect(watched('Dockerfile')).toBe(false);
    expect(watched('.gitignore')).toBe(false);
    expect(watched('build.gradle')).toBe(false);
    expect(watched('settings.gradle')).toBe(false);
    expect(watched('Makefile')).toBe(false);
  });

  test('an empty file_path is never watched', () => {
    expect(watched('')).toBe(false);
  });
});

// --- AC-2 (AC-0a3cc0bb) — src/-segment rule preserved + SSoT lives in toolchain ---

describe('AC-2 · the src/-segment rule admits ARBITRARY extensions (pinned current behavior)', () => {
  test('[covers:F-63b989e5/AC-0a3cc0bb] any path with a src/ segment is watched regardless of extension', () => {
    expect(watched('src/config.json')).toBe(true); // config extension, but under src/
    expect(watched('src/data.yaml')).toBe(true);
    expect(watched('src/notes.md')).toBe(true);
    expect(watched('src/opaque.xyz')).toBe(true); // unknown extension
    expect(watched('app/src/main/kotlin/App.kt')).toBe(true); // nested src/ segment
    expect(watched('deep/nested/src/thing.bin')).toBe(true);
    expect(watched('src\\config.json')).toBe(true); // Windows separator ([\\/] arm)
  });

  test('the rule is segment-anchored, not a substring match', () => {
    expect(watched('mysrc/foo.md')).toBe(false); // "mysrc/" is not a src/ segment
    expect(watched('resources/foo.md')).toBe(false);
  });

  test('zero regression: the shipped hook.test.ts verdicts are preserved', () => {
    expect(watched('src/foo.ts')).toBe(true); // hook.test.ts EDIT_SRC case
    expect(watched('docs/readme.md')).toBe(false); // hook.test.ts non-source case
  });
});

describe('AC-2 · WATCHED_EXTENSIONS is the single-source table exported from toolchain', () => {
  test('it is a Set, dot-prefixed + lowercased, and holds .ts/.tsx/.kt at minimum', () => {
    expect(WATCHED_EXTENSIONS).toBeInstanceOf(Set);
    for (const ext of ['.ts', '.tsx', '.kt']) {
      expect(WATCHED_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  test('it is a superset of every extension the shard claims', () => {
    for (const ext of IN_SET_EXTENSIONS) {
      expect(WATCHED_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  test('it excludes non-source and the .mjs/.cjs gap (only .mts/.cts are in)', () => {
    for (const ext of ['.md', '.yaml', '.json', '.lock', '.gradle', '.mjs', '.cjs', '.rake']) {
      expect(WATCHED_EXTENSIONS.has(ext)).toBe(false);
    }
  });
});

// --- AC-4 (AC-7e325488) — synchronous, deterministic, fs-free, O(1) ---

describe('AC-4 · the check is deterministic and O(1) (pure string/set membership)', () => {
  test('repeated verdicts for the same path are stable (no hidden state)', () => {
    for (let i = 0; i < 3; i++) {
      expect(watched('app/page.tsx')).toBe(true);
      expect(watched('README.md')).toBe(false);
    }
  });

  test('10k SSoT membership checks run well under 50ms (no fs, no per-call rebuild)', () => {
    // isWatchedSourcePath is private, so this pins the O(1)-ness of the exact
    // surface it is composed of: the frozen src/ regex + the exported set. The
    // ACTUAL function's determinism is pinned above via the hook drive.
    const srcRule = /(^|[\\/])src[\\/]/;
    const check = (p: string): boolean =>
      p.length > 0 && (srcRule.test(p) || WATCHED_EXTENSIONS.has(extname(p).toLowerCase()));
    const paths = [
      'app/page.tsx',
      'core/src/main/kotlin/App.kt',
      'README.md',
      'pkg/user.rb',
      'build.gradle',
      'MyApp/Program.cs',
    ];
    for (let i = 0; i < 1000; i++) check(paths[i % paths.length]); // warm the JIT
    let hits = 0;
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) if (check(paths[i % paths.length])) hits++;
    const elapsed = performance.now() - start;
    expect(hits).toBeGreaterThan(0); // guard against dead-code elimination
    expect(elapsed).toBeLessThan(50);
  });
});

// --- AC-1 end-to-end — the widening reaches the rendered card, not just the predicate ---

describe('AC-1 end-to-end · editing app/page.tsx in a project that owns it fires the card', () => {
  test('a .tsx module OUTSIDE src/ produces an impact card (pre-fix: no card at all)', () => {
    // The hook hardcoded {.ts .js .py .rs .go} before this feature — a Next.js
    // app/page.tsx got NO card. This drives the FULL hook (loadSpec →
    // buildWorkingSet/ImpactSlice → card) so we prove the card renders, not just
    // that the predicate flipped.
    writeFileSync(
      join(cwd, 'spec.yaml'),
      [
        'schema: "0.1"',
        'project: {name: nextjs, language: typescript}',
        'features:',
        '  - id: F-a1b2c3', // hex id (loadSpec enforces ^F-(\\d{3,}|[a-f0-9]{6,})$)
        '    slug: home',
        '    title: home page',
        '    status: done',
        '    modules: [app/page.tsx]',
        '    acceptance_criteria:',
        '      - id: AC-001',
        '        ears: ubiquitous',
        '        text: t',
        '        test_refs: [tests/home.test.ts]',
        '',
      ].join('\n'),
      'utf8',
    );
    const out = runHookEvent(
      'PostToolUse',
      {
        tool_name: 'Edit',
        tool_input: {
          file_path: join(cwd, 'app/page.tsx'),
          new_string: 'export default function Page() { return null; }',
        },
      },
      cwd,
    );
    // Both card lanes (working-set push card + formatImpactCard fallback) share
    // the "cladding impact: <rel> → <id>" line-1, so this holds either way.
    expect(out).toContain('cladding impact: app/page.tsx →');
    expect(out).toContain('F-a1b2c3');
  });
});
