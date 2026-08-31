// Cladding · integration tests for `clad report` (F-f6cc5e5a)
//
// Driven against a REAL temp git repo (init → shard + owned source → tag v0 →
// change commit that flips the shard to done, edits the owned file, adds an
// unowned file), because the CLI's contract is about what git + spec say. The
// CLI is spawned as a subprocess so its real exit codes are observable
// (runReportCommand calls process.exit on the error paths).
//   - AC-cbf1c202 · six sections present; two runs byte-identical; exit 0
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
  '## How the acceptance criteria moved',
  '## Code changes → owning features',
  '## Declared tests',
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

  test('AC-cbf1c202 · renders all six sections in order and exits 0', () => {
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

describe('AC-1a6cb22f / AC-4b6fe145 / AC-8e748acb · anchoring the range on the fork point', () => {
  let dir: string;

  function mkShard(id: string, slug: string, status: string, text: string): string {
    return [
      `id: ${id}`,
      `slug: ${slug}`,
      `title: "${slug}"`,
      `status: ${status}`,
      'acceptance_criteria:',
      '  - id: AC-000001',
      '    ears: ubiquitous',
      `    text: "${text}"`,
      '',
    ].join('\n');
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-report-fork-'));
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'test']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    git(dir, ['config', 'init.defaultBranch', 'main']);
    git(dir, ['checkout', '-q', '-b', 'main']);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'src'), {recursive: true});

    writeFileSync(join(dir, 'spec.yaml'), SPEC_YAML);
    writeFileSync(
      join(dir, 'spec', 'features', 'mine-aaaa1111.yaml'),
      mkShard('F-aaaa1111', 'mine', 'planned', 'The system shall do my thing.'),
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'theirs-bbbb2222.yaml'),
      mkShard('F-bbbb2222', 'theirs', 'planned', 'The system shall do their thing.'),
    );
    writeFileSync(join(dir, 'src', 'mine.ts'), 'export const mine = "base";\n');
    writeFileSync(join(dir, 'src', 'theirs.ts'), 'export const theirs = "base";\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'baseline']);
    git(dir, ['tag', 'v0']);

    // The BASE branch moves on after the fork — someone else rewrites their
    // own entry's criterion. This must never be charged to our branch.
    writeFileSync(
      join(dir, 'spec', 'features', 'theirs-bbbb2222.yaml'),
      mkShard('F-bbbb2222', 'theirs', 'done', 'The system shall do their thing DIFFERENTLY.'),
    );
    writeFileSync(join(dir, 'src', 'theirs.ts'), 'export const theirs = "main-only";\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'their work on main']);

    // Our branch forks from v0 and rewrites only our own entry.
    git(dir, ['checkout', '-q', '-b', 'feature/mine', 'v0']);
    writeFileSync(
      join(dir, 'spec', 'features', 'mine-aaaa1111.yaml'),
      mkShard('F-aaaa1111', 'mine', 'done', 'The system shall do my thing REVISED.'),
    );
    writeFileSync(join(dir, 'src', 'mine.ts'), 'export const mine = "feature-only";\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'my work']);
  });

  afterAll(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test("AC-1a6cb22f · the base branch's own rewrite is not attributed to this range", () => {
    const ran = runClad(dir, ['report', '--since', 'main', '--format', 'json']);
    expect(ran.status).toBe(0);
    const model = JSON.parse(ran.stdout) as {
      specEntryDeltas: {id: string; counts: {rewritten: number}}[];
    };
    const ids = model.specEntryDeltas.map((d) => d.id);
    expect(ids).toContain('F-aaaa1111');
    // Diffing tip-to-tip would report F-bbbb2222 as REMOVED-and-rewritten here;
    // anchoring on the merge base leaves their work out of our packet.
    expect(ids).not.toContain('F-bbbb2222');
  });

  test('AC-1a6cb22f · our own rewrite is still reported', () => {
    const ran = runClad(dir, ['report', '--since', 'main', '--format', 'json']);
    const model = JSON.parse(ran.stdout) as {
      specEntryDeltas: {id: string; counts: {rewritten: number}}[];
    };
    expect(model.specEntryDeltas.find((d) => d.id === 'F-aaaa1111')?.counts.rewritten).toBe(1);
  });

  test('[covers:F-5dfbac9c/AC-1a6cb22f] the resolved merge base controls both spec deltas and changed source paths', () => {
    const ran = runClad(dir, ['report', '--since', 'main', '--format', 'json']);
    expect(ran.status, ran.stderr).toBe(0);
    const model = JSON.parse(ran.stdout) as {
      specEntryDeltas: {id: string}[];
      unowned: string[];
    };
    expect(model.specEntryDeltas.map((delta) => delta.id)).toContain('F-aaaa1111');
    expect(model.specEntryDeltas.map((delta) => delta.id)).not.toContain('F-bbbb2222');
    expect(model.unowned).toContain('src/mine.ts');
    expect(model.unowned).not.toContain('src/theirs.ts');
  });

  test('[covers:F-5dfbac9c/AC-4b6fe145] AC-4b6fe145 · a shallow clone with no merge base still renders a packet', () => {
    const shallow = mkdtempSync(join(tmpdir(), 'clad-report-shallow-'));
    try {
      execFileSync('git', ['clone', '-q', '--depth', '1', `file://${dir}`, shallow, '--branch', 'feature/mine'], {
        encoding: 'utf8',
      });
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: shallow, encoding: 'utf8'}).trim();
      // No history to walk: `git merge-base <head> HEAD` cannot resolve a fork
      // point here, so the helper must fall back to the ref rather than fail.
      const ran = runClad(shallow, ['report', '--since', head, '--format', 'md']);
      expect(ran.status).toBe(0);
      expect(ran.stdout).toContain('## How the acceptance criteria moved');
    } finally {
      rmSync(shallow, {recursive: true, force: true});
    }
  });

  test('[covers:F-5dfbac9c/AC-8e748acb] AC-8e748acb · a rewritten criterion does not change the exit code', () => {
    const withRewrite = runClad(dir, ['report', '--since', 'v0']);
    expect(withRewrite.status).toBe(0);
    expect(withRewrite.stdout).toContain('REWRITTEN AC-000001');

    // Same command from a state with no spec movement at all — same exit code.
    const noMovement = runClad(dir, ['report', '--since', 'HEAD']);
    expect(noMovement.status).toBe(0);
  });
});

describe('the packet names the revision it audited against', () => {
  test('the json model carries the resolved base alongside the ref the user named', () => {
    // Recorded on the fork-point fixture built above: `main` and the merge base
    // are different commits there, so `since` alone does not identify the
    // comparison. Both must be present for an auditor to reproduce it.
    const forked = mkdtempSync(join(tmpdir(), 'clad-report-basestamp-'));
    try {
      git(forked, ['init', '-q']);
      git(forked, ['config', 'user.email', 'test@example.com']);
      git(forked, ['config', 'user.name', 'test']);
      git(forked, ['config', 'commit.gpgsign', 'false']);
      mkdirSync(join(forked, 'spec', 'features'), {recursive: true});
      writeFileSync(join(forked, 'spec.yaml'), SPEC_YAML);
      writeFileSync(join(forked, 'spec', 'features', 'owned-feature-aaaa1111.yaml'), shard('in_progress'));
      writeFileSync(join(forked, 'src.ts'), 'export const a = 1;\n');
      git(forked, ['add', '-A']);
      git(forked, ['commit', '-q', '-m', 'baseline']);
      git(forked, ['tag', 'v0']);
      git(forked, ['branch', '-M', 'main']);
      // main moves on; our branch forks from v0, so v0 !== the merge base of main and HEAD.
      writeFileSync(join(forked, 'src.ts'), 'export const a = 2;\n');
      git(forked, ['add', '-A']);
      git(forked, ['commit', '-q', '-m', 'their work']);
      git(forked, ['checkout', '-q', '-b', 'mine', 'v0']);
      writeFileSync(join(forked, 'src.ts'), 'export const a = 3;\n');
      git(forked, ['add', '-A']);
      git(forked, ['commit', '-q', '-m', 'my work']);

      const ran = runClad(forked, ['report', '--since', 'main', '--format', 'json']);
      expect(ran.status).toBe(0);
      const model = JSON.parse(ran.stdout) as {since: string; base: string; head: string};
      expect(model.since).toBe('main');
      expect(model.base).toBeTruthy();
      expect(model.base).not.toBe(model.head);
      // The stamped base is the fork point, not the tip of the ref that was named.
      const mainTip = execFileSync('git', ['rev-parse', 'main'], {cwd: forked, encoding: 'utf8'}).trim();
      expect(model.base).not.toBe(mainTip);
    } finally {
      rmSync(forked, {recursive: true, force: true});
    }
  });
});

describe('the base disclosure appears only when the base is a different commit', () => {
  test('a linear range says nothing — the named ref IS the merge base', () => {
    const lin = mkdtempSync(join(tmpdir(), 'clad-report-linear-'));
    try {
      git(lin, ['init', '-q']);
      git(lin, ['config', 'user.email', 'test@example.com']);
      git(lin, ['config', 'user.name', 'test']);
      git(lin, ['config', 'commit.gpgsign', 'false']);
      mkdirSync(join(lin, 'spec', 'features'), {recursive: true});
      writeFileSync(join(lin, 'spec.yaml'), SPEC_YAML);
      writeFileSync(join(lin, 'spec', 'features', 'owned-feature-aaaa1111.yaml'), shard('in_progress'));
      writeFileSync(join(lin, 'src.ts'), 'export const a = 1;\n');
      git(lin, ['add', '-A']);
      git(lin, ['commit', '-q', '-m', 'baseline']);
      git(lin, ['tag', 'v0']);
      writeFileSync(join(lin, 'src.ts'), 'export const a = 2;\n');
      git(lin, ['add', '-A']);
      git(lin, ['commit', '-q', '-m', 'work']);

      const ran = runClad(lin, ['report', '--since', 'v0']);
      expect(ran.status).toBe(0);
      // Before this was decided by comparing a ref name to a sha, it fired here.
      expect(ran.stdout).not.toContain('Compared against');
    } finally {
      rmSync(lin, {recursive: true, force: true});
    }
  });

  test('an ANNOTATED tag on the merge base is also silent — the ref is peeled, not string-compared', () => {
    const ann = mkdtempSync(join(tmpdir(), 'clad-report-annotated-'));
    try {
      git(ann, ['init', '-q']);
      git(ann, ['config', 'user.email', 'test@example.com']);
      git(ann, ['config', 'user.name', 'test']);
      git(ann, ['config', 'commit.gpgsign', 'false']);
      mkdirSync(join(ann, 'spec', 'features'), {recursive: true});
      writeFileSync(join(ann, 'spec.yaml'), SPEC_YAML);
      writeFileSync(join(ann, 'spec', 'features', 'owned-feature-aaaa1111.yaml'), shard('in_progress'));
      writeFileSync(join(ann, 'src.ts'), 'export const a = 1;\n');
      git(ann, ['add', '-A']);
      git(ann, ['commit', '-q', '-m', 'baseline']);
      // An annotated tag object is NOT the commit it points at.
      git(ann, ['tag', '-a', 'v1', '-m', 'release one']);
      writeFileSync(join(ann, 'src.ts'), 'export const a = 2;\n');
      git(ann, ['add', '-A']);
      git(ann, ['commit', '-q', '-m', 'work']);

      const ran = runClad(ann, ['report', '--since', 'v1']);
      expect(ran.status).toBe(0);
      expect(ran.stdout).not.toContain('Compared against');
    } finally {
      rmSync(ann, {recursive: true, force: true});
    }
  });
});
