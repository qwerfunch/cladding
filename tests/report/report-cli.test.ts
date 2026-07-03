// Cladding · integration tests for `clad report` (F-f6cc5e5a)
//
// Driven against a REAL temp git repo (init → shard + owned source → tag v0 →
// change commit that flips the shard to done, edits the owned file, adds an
// unowned file), because the CLI's contract is about what git + spec say. The
// CLI is spawned as a subprocess so its real exit codes are observable
// (runReportCommand calls process.exit on the error paths).
//   - AC-cbf1c202 · four sections present; two runs byte-identical; exit 0
//   - AC-7672ce5d · the unowned file surfaces; the owned file never does
//   - AC-67fa1d25 · unresolvable --since → exit 2 naming the ref; valid → exit 0
//   - unknown --format → exit 1 (pinned current behaviour)
//   - pipe-safety   · the command uses process.exitCode (not process.exit(0))
//                     so a >64KB packet survives a pipe — pinned structurally
//                     (a >64KB behavioural fixture is expensive/flaky).

import {spawnSync} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX = join(REPO, 'node_modules', '.bin', 'tsx');
const CLAD = join(REPO, 'src', 'cli', 'clad.ts');

interface Ran {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `clad <args>` with the temp repo as cwd; returns exit status + streams. */
function runClad(cwd: string, args: readonly string[]): Ran {
  const res = spawnSync(TSX, [CLAD, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? ''};
}

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', [...args], {cwd: dir, encoding: 'utf8'});
}

function shard(status: string): string {
  return [
    'id: F-aaaa1111',
    'slug: owned-feature',
    'title: "Owned feature"',
    `status: ${status}`,
    'modules:',
    '  - src/owned.ts',
    'acceptance_criteria:',
    '  - id: AC-000001',
    '    ears: ubiquitous',
    '    text: "The system shall own the file."',
    '    test_refs:',
    '      - tests/owned.test.ts#owns it',
    '',
  ].join('\n');
}

const SPEC_YAML = [
  'schema: "0.1"',
  'project:',
  '  name: probe',
  '  language: typescript',
  'inventory:',
  '  features: 1',
  '  scenarios: 0',
  '  capabilities: 0',
  '  test_files: 1',
  '',
].join('\n');

const SECTIONS = [
  '## Spec changes',
  '## Code changes → owning features',
  '## Regression set',
  '## Gate & attestation',
] as const;

describe('clad report — integration (F-f6cc5e5a)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-report-'));
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'test']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'src'), {recursive: true});

    // v0 baseline: the feature is in_progress and owns src/owned.ts.
    writeFileSync(join(dir, 'spec.yaml'), SPEC_YAML);
    writeFileSync(join(dir, 'spec', 'features', 'owned-feature-aaaa1111.yaml'), shard('in_progress'));
    writeFileSync(join(dir, 'src', 'owned.ts'), 'export const owned = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'baseline']);
    git(dir, ['tag', 'v0']);

    // change commit: flip the shard to done, edit the owned file, add an
    // UNOWNED source file that no feature's `modules` declares.
    writeFileSync(join(dir, 'spec', 'features', 'owned-feature-aaaa1111.yaml'), shard('done'));
    writeFileSync(join(dir, 'src', 'owned.ts'), 'export const owned = 2;\n');
    writeFileSync(join(dir, 'src', 'orphan.ts'), 'export const orphan = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'spec: ship owned feature and touch code']);
  });

  afterAll(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('AC-cbf1c202 · renders all four sections in order and exits 0', () => {
    const run = runClad(dir, ['report', '--since', 'v0']);
    expect(run.status, run.stderr).toBe(0);
    const positions = SECTIONS.map((h) => run.stdout.indexOf(h));
    for (const [i, pos] of positions.entries()) {
      expect(pos, `section ${SECTIONS[i]} missing`).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    // the flipped shard, the owned file, and its regression ref all show up.
    expect(run.stdout).toContain('F-aaaa1111');
    expect(run.stdout).toContain('src/owned.ts');
    expect(run.stdout).toContain('tests/owned.test.ts#owns it');
  }, 30_000);

  test('AC-cbf1c202 · two runs on the same repo state are byte-identical', () => {
    const first = runClad(dir, ['report', '--since', 'v0']);
    const second = runClad(dir, ['report', '--since', 'v0']);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  }, 30_000);

  test('AC-7672ce5d · the unowned file surfaces; the owned file never appears as unowned', () => {
    const run = runClad(dir, ['report', '--since', 'v0']);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('### Unowned changes');
    expect(run.stdout).toContain('src/orphan.ts');
    const unownedBlock = run.stdout.slice(run.stdout.indexOf('### Unowned changes'));
    expect(unownedBlock).not.toContain('src/owned.ts');
  }, 30_000);

  test('AC-67fa1d25 · an unresolvable --since exits 2 with an error naming the ref', () => {
    const run = runClad(dir, ['report', '--since', 'definitely-not-a-ref']);
    expect(run.status).toBe(2);
    expect(`${run.stdout}${run.stderr}`).toContain('definitely-not-a-ref');
  }, 30_000);

  test('AC-67fa1d25 · a valid --since ref exits 0', () => {
    const run = runClad(dir, ['report', '--since', 'v0']);
    expect(run.status, run.stderr).toBe(0);
  }, 30_000);

  test('an unknown --format exits 1 (pinned current behaviour)', () => {
    const run = runClad(dir, ['report', '--since', 'v0', '--format', 'bogus']);
    expect(run.status).toBe(1);
    expect(`${run.stdout}${run.stderr}`).toContain('format');
  }, 30_000);
});

describe('clad report — pipe safety (structural pin)', () => {
  // The packet can exceed the 64KB OS pipe buffer, and a forced process.exit()
  // truncates a buffered pipe mid-write (the bug PR #201 fixed for clad check /
  // graph export). The success path MUST set process.exitCode and let the loop
  // drain stdout — never process.exit(0). Pinned by source structure rather
  // than a >64KB behavioural fixture (which would be expensive and flaky).
  test('the success path uses process.exitCode = 0, not process.exit(0)', () => {
    const src = readFileSync(join(REPO, 'src', 'cli', 'report.ts'), 'utf8');
    expect(src).toContain('process.stdout.write(out)');
    expect(src).toContain('process.exitCode = 0');
    expect(src).not.toContain('process.exit(0)');
  });
});
