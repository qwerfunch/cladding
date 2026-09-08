// Cladding · scripts/ab-abc/sidetable.ts — the agent-free L0/L3 runner
//
// Drives both engines directly (no host, no model, no spending) over the two
// fixture families expectations.yaml defines, and writes what it saw. It does
// NOT decide whether a difference is a defect: while the expectations file is
// `status: unlocked`, every guess in it is itself under test, so the runner
// records `observed` and leaves `classification` for a human. Once the file is
// locked, the runner stops being a notebook and becomes a gate: every row must
// carry a classification and a `lock:` map, and every pinned exit code, byte
// count and literal must still hold. The first difference fails the run.
//
// Usage:
//   npx tsx scripts/ab-abc/sidetable.ts --bootstrap     build the base fixtures
//   npx tsx scripts/ab-abc/sidetable.ts [--only L0-3]   run the auto rows
//
// Output: $ABC_ROOT/results/sidetable.json and sidetable.md.

import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';

import {parse} from 'yaml';

const ABC_ROOT = process.env.ABC_ROOT ?? join(homedir(), 'abc-0100');
const HARNESS = process.env.ABC_HARNESS ?? '/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc';
const FIXTURES = join(ABC_ROOT, 'sidetable');
const RESULTS = join(ABC_ROOT, 'results');
const SCRATCH = join(ABC_ROOT, 'sidetable-runs');

type Arm = 'B' | 'C';

/** One pinned observation: what a locked row's step must still produce. */
interface Pin {
  readonly exit: number | null;
  readonly bytes?: number;
  readonly contains?: readonly string[];
}

interface Step {
  readonly name: string;
  readonly run: 'cli' | 'mcp' | 'hyperfine' | 'script' | 'file';
  readonly arms: readonly Arm[];
  readonly family: string;
  readonly args?: readonly string[];
  readonly calls?: readonly unknown[];
  readonly runs?: number;
  /** `script`: a harness script run as `bash <script> <arm> <cwd> <artifactDir>`. */
  readonly script?: string;
  /** `file`: an artifact an earlier fixture build already captured. */
  readonly path?: string;
}

interface Row {
  readonly id: string;
  readonly title: string;
  readonly fixture_family: string;
  readonly mode: 'auto' | 'manual';
  readonly question: string;
  readonly recipe?: string;
  readonly steps?: readonly Step[];
  /** Applied to this row's fresh workspace before any step runs. */
  readonly mutations?: readonly string[];
  readonly expect: Record<string, unknown>;
  classification: string | null;
  /** `<step>-<arm>` → what that observation must still be. Required once locked. */
  readonly lock?: Record<string, Pin>;
}

interface Expectations {
  readonly status: 'unlocked' | 'locked';
  readonly rows: Row[];
}

interface Observation {
  readonly step: string;
  readonly arm: Arm;
  readonly kind: Step['run'];
  readonly exit: number | null;
  readonly stdoutBytes: number;
  readonly stdoutHead: string;
  readonly stderrHead: string;
  readonly artifact: string | null;
}

interface RowResult {
  readonly id: string;
  readonly fixtureFamily: string;
  readonly question: string;
  readonly b: string;
  readonly c: string;
  readonly expectation: string;
  readonly verdict: string;
  readonly observations: readonly Observation[];
}

const armPrefix = (arm: Arm): string => join(ABC_ROOT, `prefix-${arm}`);
const armBin = (arm: Arm): string => join(armPrefix(arm), 'bin', 'clad');

const head = (text: string, limit = 400): string => (text.length <= limit ? text : `${text.slice(0, limit)}…`);

/** Runs a command, never throwing on a non-zero exit — an exit code is data. */
function run(command: string, args: readonly string[], cwd: string): {exit: number | null; stdout: string; stderr: string} {
  const result = spawnSync(command, [...args], {cwd, encoding: 'utf8', timeout: 300_000});
  return {exit: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? ''};
}

/** The template + npm ci + an initial commit — the state every fixture starts from. */
function seedWorkspace(dest: string): void {
  rmSync(dest, {recursive: true, force: true});
  mkdirSync(dest, {recursive: true});
  cpSync(join(HARNESS, 'template'), dest, {recursive: true});
  mkdirSync(join(dest, 'src'), {recursive: true});
  mkdirSync(join(dest, 'tests'), {recursive: true});
  const ci = run('npm', ['ci'], dest);
  if (ci.exit !== 0) throw new Error(`npm ci failed in ${dest}: ${head(ci.stderr)}`);
  run('git', ['init', '--quiet'], dest);
  run('git', ['config', 'user.name', 'abc-harness'], dest);
  run('git', ['config', 'user.email', 'abc-harness@example.invalid'], dest);
  run('git', ['add', '-A'], dest);
  run('git', ['commit', '--quiet', '-m', 'chore: project skeleton'], dest);
}

/** The module the shared fixture's one feature binds to. */
const SHARED_MODULE = [
  '// Fixture module — turns a title into a URL slug.',
  '',
  'export function slugify(input: string): string {',
  "  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');",
  '}',
  '',
].join('\n');

/**
 * Creates the shared fixture's single feature through the released engine's MCP
 * surface and returns its id. Going through the tool rather than writing YAML by
 * hand keeps the fixture in the shape a host would have produced.
 */
function createSharedFeature(dest: string): string {
  const callsPath = join(dest, '.abc-shared-feature.calls.json');
  const outPath = join(dest, '.abc-shared-feature.out.json');
  writeFileSync(callsPath, `${JSON.stringify([{
    type: 'tool',
    name: 'clad_create_feature',
    args: {
      slug: 'slugify',
      title: 'Turn a title into a URL slug',
      modules: ['src/slugify.ts'],
      acceptance_criteria: [{ears: 'ubiquitous', text: 'The system shall convert a title into a lower-case hyphenated slug.'}],
    },
  }], null, 2)}\n`);
  const result = run('node', [join(HARNESS, 'mcp-client.mjs'), '--cwd', dest, '--server', `${armBin('B')} serve`, '--calls', callsPath, '--out', outPath], dest);
  const payload = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  rmSync(callsPath, {force: true});
  rmSync(outPath, {force: true});
  if (/"isError":\s*true/.test(payload)) throw new Error(`shared-0.1 feature was refused: ${head(payload, 600)}`);
  const id = payload.match(/F-[0-9a-f]{6,8}/);
  if (id === null) throw new Error(`no feature id in the shared create result (exit ${result.exit}): ${head(payload, 600)}`);
  return id[0];
}

/** The id of the shared fixture's feature, for rows that must name one. */
function sharedFeatureId(): string {
  const path = join(FIXTURES, 'shared-0.1.feature');
  if (!existsSync(path)) throw new Error(`no ${path} — re-run --bootstrap so the shared feature exists`);
  return readFileSync(path, 'utf8').trim();
}

/** Builds the two fixture families. Both engines must already be frozen. */
function bootstrap(): void {
  for (const arm of ['B', 'C'] as const) {
    if (!existsSync(armBin(arm))) throw new Error(`arm ${arm} has no engine at ${armBin(arm)} — run freeze.sh first`);
  }

  // shared-0.1 — scaffolded ONCE, by the released engine, then driven by both.
  const shared = join(FIXTURES, 'shared-0.1');
  seedWorkspace(shared);
  const initB = run(armBin('B'), ['init', '--no-llm'], shared);
  if (initB.exit !== 0) throw new Error(`shared-0.1 init failed: ${head(initB.stderr || initB.stdout)}`);
  // A bare scaffold has no feature at all, so every row that asks a question
  // ABOUT a feature — the context payload, the working set, a graph radius —
  // was answering about an empty project. One feature is therefore created here,
  // ONCE, by the released engine, and its id recorded beside the fixture: both
  // arms then read the identical bytes and the same id, which is what makes a
  // byte-for-byte comparison mean anything.
  writeFileSync(join(shared, 'src', 'slugify.ts'), SHARED_MODULE);
  const sharedFeature = createSharedFeature(shared);
  writeFileSync(join(FIXTURES, 'shared-0.1.feature'), `${sharedFeature}\n`);
  run(armBin('B'), ['sync'], shared);
  run('git', ['add', '-A'], shared);
  run('git', ['commit', '--quiet', '-m', 'chore: cladding 0.1 workspace'], shared);
  process.stdout.write(`shared-0.1 carries feature ${sharedFeature}\n`);

  // per-version-init — each engine scaffolds its own default from the identical
  // template, so the delta measured is the scaffold, not the project.
  for (const arm of ['B', 'C'] as const) {
    const dest = join(FIXTURES, 'per-version-init', arm);
    seedWorkspace(dest);
    const args = arm === 'C' ? ['init', '--schema', '0.2', '--no-llm'] : ['init', '--no-llm'];
    const init = run(armBin(arm), args, dest);
    if (init.exit !== 0) throw new Error(`per-version-init ${arm} init failed: ${head(init.stderr || init.stdout)}`);
    run('git', ['add', '-A'], dest);
    run('git', ['commit', '--quiet', '-m', 'chore: cladding workspace'], dest);
  }

  // The completed-feature fixture: rows about warn severity, completion wording,
  // the independence policy, vacuous greens and migration all need a project
  // that has genuinely finished something.
  for (const arm of ['B', 'C'] as const) {
    const built = run('bash', [join(HARNESS, 'make-done-fixture.sh'), arm], HARNESS);
    if (built.exit !== 0) {
      process.stderr.write(`done fixture for arm ${arm} did not build: ${head(built.stderr || built.stdout)}\n`);
    } else {
      process.stdout.write(`${built.stdout.trim()}\n`);
    }
  }

  // The L4 row replays the documented completion recipe, which raises the level
  // BEFORE the feature completes — so it needs a project stopped one step short
  // of `clad done`, not one already finished at L2.
  const inProgress = run('bash', [join(HARNESS, 'make-done-fixture.sh'), 'C', '--stop-before-done'], HARNESS);
  if (inProgress.exit !== 0) {
    process.stderr.write(`in-progress fixture for arm C did not build: ${head(inProgress.stderr || inProgress.stdout)}\n`);
  } else {
    process.stdout.write(`${inProgress.stdout.trim()}\n`);
  }

  process.stdout.write(`bootstrapped fixtures under ${FIXTURES}\n`);
}

/**
 * One disposable workspace per row and arm — created on first use and reused by
 * that row's later steps, because a row's steps are a sequence: L3-1's `check`
 * has to run on the workspace its own `sync` just wrote. Different rows never
 * share, so no row can see another's writes.
 *
 * `node_modules` is symlinked rather than copied: it is identical in every
 * fixture and copying it per row turns a fast table into a slow one.
 */
function familyRoot(family: string, arm: Arm): string {
  if (family === 'per-version-init') return join(FIXTURES, 'per-version-init', arm);
  if (family === 'done') return join(FIXTURES, 'done', arm);
  if (family === 'inprogress') return join(FIXTURES, 'inprogress', arm);
  return join(FIXTURES, 'shared-0.1');
}

function checkout(family: string, arm: Arm, rowId: string): string {
  const source = familyRoot(family, arm);
  if (!existsSync(source)) throw new Error(`missing fixture ${source} — run --bootstrap first`);
  const dest = join(SCRATCH, `${rowId}-${arm}`);
  if (existsSync(dest)) return dest;
  mkdirSync(dest, {recursive: true});
  cpSync(source, dest, {recursive: true, filter: (src) => !src.split('/').includes('node_modules')});
  const modules = join(source, 'node_modules');
  if (existsSync(modules)) symlinkSync(modules, join(dest, 'node_modules'), 'dir');
  return dest;
}

/**
 * Row mutations — the deliberate damage a row needs before it can ask its
 * question. Each one is named in expectations.yaml, so a reader can see what was
 * broken without reading the code, and each is applied to that row's own fresh
 * workspace so it cannot leak into another row.
 */
const MUTATIONS: Record<string, (cwd: string) => void> = {
  /**
   * Drops every leading comment so the file's first non-empty line is code —
   * which is exactly what CONVENTION_DRIFT (warn) looks at.
   *
   * The earlier version dropped only a first `//` line, which left the module's
   * next line — a JSDoc block — as the first non-empty line. The
   * detector accepts `//`, `/*`, `#`, `"""` and `'''` alike, so the mutated file
   * still opened with a comment and no finding fired: the row measured nothing.
   * Both leading forms are therefore removed, and a mutation that changes no
   * bytes, or leaves a comment in front, fails the row instead of passing
   * quietly.
   */
  'strip-module-header': (cwd) => {
    const file = join(cwd, 'src', 'slugify.ts');
    const before = readFileSync(file, 'utf8');
    const lines = before.split('\n');
    while (lines.length > 0) {
      const line = (lines[0] ?? '').trimStart();
      if (line === '') { lines.shift(); continue; }
      if (line.startsWith('//')) { lines.shift(); continue; }
      if (line.startsWith('/*')) {
        // Drop through the line that closes the block, wherever it ends.
        while (lines.length > 0) {
          const dropped = lines.shift() ?? '';
          if (dropped.includes('*/')) break;
        }
        continue;
      }
      break;
    }
    const after = lines.join('\n');
    if (after === before) throw new Error(`strip-module-header changed no bytes in ${file}`);
    const firstLine = (after.split('\n').find((line) => line.trim() !== '') ?? '').trimStart();
    if (/^(\/\/|\/\*|#|"""|''')/.test(firstLine)) {
      throw new Error(`strip-module-header left a comment first in ${file}: ${firstLine.slice(0, 60)}`);
    }
    writeFileSync(file, after);
  },

  /**
   * The vacuous green: the feature's own tests are every one skipped, while a
   * second, unrelated test file still exercises the module — so coverage stays
   * up and nothing proves the criteria.
   */
  'vacuous-green': (cwd) => {
    const own = join(cwd, 'tests', 'slugify.test.ts');
    writeFileSync(own, readFileSync(own, 'utf8').replace(/\btest\(/g, 'test.skip('));
    writeFileSync(
      join(cwd, 'tests', 'incidental.test.ts'),
      [
        '// A neighbouring test that touches the module without claiming anything.',
        "import {describe, expect, test} from 'vitest';",
        '',
        "import {slugify} from '../src/slugify.js';",
        '',
        "describe('incidental coverage', () => {",
        "  test('the module runs', () => {",
        "    expect(slugify('Hello World!')).toBe('hello-world');",
        '  });',
        '});',
        '',
      ].join('\n'),
    );
  },

  /** Turns the independence policy up, so a self-signed receipt must be refused. */
  'require-independence': (cwd) => {
    const file = join(cwd, 'spec.yaml');
    const raw = readFileSync(file, 'utf8');
    writeFileSync(
      file,
      /independence_policy:/.test(raw)
        ? raw.replace(/independence_policy:.*/, 'independence_policy: require')
        : raw.replace(/^(project:\s*\n)/m, '$1  independence_policy: require\n'),
    );
  },

  /** Moves the covers token from the head of each test title to its end. */
  'covers-token-trailing': (cwd) => {
    const file = join(cwd, 'tests', 'slugify.test.ts');
    const raw = readFileSync(file, 'utf8');
    writeFileSync(
      file,
      raw.replace(/(['"`])(\[covers:[^\]]+\])\s*([^'"`]*)\1/g, (_m, quote, token, rest) => `${quote}${rest} ${token}${quote}`),
    );
  },
};

function runStep(row: Row, step: Step, arm: Arm): Observation {
  const family = step.family ?? row.fixture_family;
  const fresh = !existsSync(join(SCRATCH, `${row.id}-${arm}`));
  const cwd = checkout(family, arm, row.id);
  const artifactDir = join(RESULTS, 'sidetable', row.id);
  mkdirSync(artifactDir, {recursive: true});

  // Mutations run once, on the row's first step, against its fresh workspace.
  if (fresh) {
    for (const name of row.mutations ?? []) {
      const mutate = MUTATIONS[name];
      if (mutate === undefined) throw new Error(`row ${row.id} names an unknown mutation: ${name}`);
      mutate(cwd);
    }
  }

  if (step.run === 'file') {
    const path = (step.path ?? '').replace('{root}', ABC_ROOT).replace('{arm}', arm);
    const body = existsSync(path) ? readFileSync(path, 'utf8') : '';
    return {
      step: step.name,
      arm,
      kind: 'file',
      exit: existsSync(path) ? 0 : null,
      stdoutBytes: Buffer.byteLength(body),
      stdoutHead: body === '' ? `no such captured artifact: ${path}` : head(body),
      stderrHead: '',
      artifact: existsSync(path) ? path : null,
    };
  }

  if (step.run === 'script') {
    const script = join(HARNESS, step.script ?? '');
    if (!existsSync(script)) throw new Error(`row ${row.id} names a missing script: ${script}`);
    const artifact = join(artifactDir, `${step.name}-${arm}.log`);
    const r = run('bash', [script, arm, cwd, artifactDir], cwd);
    writeFileSync(artifact, `${r.stdout}\n--- stderr ---\n${r.stderr}`);
    return {
      step: step.name,
      arm,
      kind: 'script',
      exit: r.exit,
      stdoutBytes: Buffer.byteLength(r.stdout),
      stdoutHead: head(r.stdout),
      stderrHead: head(r.stderr),
      artifact,
    };
  }

  if (step.run === 'cli') {
    const r = run(armBin(arm), step.args ?? [], cwd);
    const artifact = join(artifactDir, `${step.name}-${arm}.stdout`);
    writeFileSync(artifact, r.stdout);
    return {
      step: step.name,
      arm,
      kind: 'cli',
      exit: r.exit,
      stdoutBytes: Buffer.byteLength(r.stdout),
      stdoutHead: head(r.stdout),
      stderrHead: head(r.stderr),
      artifact,
    };
  }

  if (step.run === 'mcp') {
    const callsPath = join(artifactDir, `${step.name}-${arm}.calls.json`);
    // `{shared_feature}` lets a row name the shared fixture's feature without
    // hard-coding an id the bootstrap regenerates.
    const rendered = JSON.stringify(step.calls ?? [], null, 2).includes('{shared_feature}')
      ? JSON.stringify(step.calls ?? [], null, 2).split('{shared_feature}').join(sharedFeatureId())
      : JSON.stringify(step.calls ?? [], null, 2);
    writeFileSync(callsPath, `${rendered}\n`);
    const artifact = join(artifactDir, `${step.name}-${arm}.mcp.json`);
    const r = run(
      'node',
      [join(HARNESS, 'mcp-client.mjs'), '--cwd', cwd, '--server', `${armBin(arm)} serve`, '--calls', callsPath, '--out', artifact],
      cwd,
    );
    const payload = existsSync(artifact) ? readFileSync(artifact, 'utf8') : '';
    return {
      step: step.name,
      arm,
      kind: 'mcp',
      exit: r.exit,
      stdoutBytes: Buffer.byteLength(payload),
      stdoutHead: head(payload),
      stderrHead: head(r.stderr),
      artifact,
    };
  }

  // hyperfine — timing only, and only when the tool is installed. A missing
  // benchmarking tool is recorded as not-run, never as a fast or slow result.
  const probe = run('hyperfine', ['--version'], cwd);
  if (probe.exit !== 0) {
    return {
      step: step.name,
      arm,
      kind: 'hyperfine',
      exit: null,
      stdoutBytes: 0,
      stdoutHead: 'hyperfine is not installed — timing not measured',
      stderrHead: '',
      artifact: null,
    };
  }
  const artifact = join(artifactDir, `${step.name}-${arm}.hyperfine.json`);
  const command = [armBin(arm), ...(step.args ?? [])].join(' ');
  const r = run('hyperfine', ['-r', String(step.runs ?? 5), '--export-json', artifact, command], cwd);
  return {
    step: step.name,
    arm,
    kind: 'hyperfine',
    exit: r.exit,
    stdoutBytes: Buffer.byteLength(r.stdout),
    stdoutHead: head(r.stdout),
    stderrHead: head(r.stderr),
    artifact,
  };
}

/** One-line summary of what an arm did in this row, for the rendered table. */
function summarise(observations: readonly Observation[], arm: Arm): string {
  const mine = observations.filter((o) => o.arm === arm);
  if (mine.length === 0) return 'not run';
  return mine.map((o) => `${o.step}: exit ${o.exit ?? 'n/a'}, ${o.stdoutBytes}B`).join('; ');
}

/**
 * The lock, enforced. For every pinned `<step>-<arm>` the run must have produced
 * an observation with that exit code, that byte count where one is pinned, and
 * every literal the pin names — read from the artifact on disk, because the
 * observation carries only a truncated head.
 *
 * A locked row with no classification or no `lock:` map is itself a mismatch:
 * locking a row without pinning anything would make the gate vacuous, which is
 * the failure mode this whole campaign exists to avoid.
 */
function checkLock(expectations: Expectations, results: readonly RowResult[]): string[] {
  const mismatches: string[] = [];
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const row of expectations.rows) {
    if (row.classification === null) mismatches.push(`${row.id}: locked but unclassified`);
    const pins = row.lock;
    if (pins === undefined || Object.keys(pins).length === 0) {
      mismatches.push(`${row.id}: locked but pins nothing`);
      continue;
    }
    const result = byId.get(row.id);
    if (result === undefined) {
      mismatches.push(`${row.id}: locked but this run has no result for it`);
      continue;
    }
    for (const [key, pin] of Object.entries(pins)) {
      const observation = result.observations.find((o) => `${o.step}-${o.arm}` === key);
      if (observation === undefined) {
        mismatches.push(`${row.id} ${key}: pinned, but the run produced no such observation`);
        continue;
      }
      if (observation.exit !== pin.exit) {
        mismatches.push(`${row.id} ${key}: pinned exit ${pin.exit}, saw ${observation.exit}`);
      }
      if (pin.bytes !== undefined && observation.stdoutBytes !== pin.bytes) {
        mismatches.push(`${row.id} ${key}: pinned ${pin.bytes}B, saw ${observation.stdoutBytes}B`);
      }
      const literals = pin.contains ?? [];
      if (literals.length === 0) continue;
      const body = observation.artifact !== null && existsSync(observation.artifact)
        ? readFileSync(observation.artifact, 'utf8')
        : observation.stdoutHead;
      for (const literal of literals) {
        if (!body.includes(literal)) mismatches.push(`${row.id} ${key}: pinned text absent — ${JSON.stringify(literal)}`);
      }
    }
  }
  return mismatches;
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--bootstrap')) {
    bootstrap();
    return;
  }

  const onlyIndex = argv.indexOf('--only');
  // `--only A,B` re-runs a few rows; the rest of the table is carried forward
  // from the previous run rather than blanked, so a targeted re-run cannot lose
  // the record of the rows it did not touch.
  const only = onlyIndex === -1 ? null : new Set((argv[onlyIndex + 1] ?? '').split(',').map((id) => id.trim()).filter((id) => id !== ''));

  // Which engine is which is the one thing this table cannot get wrong.
  for (const arm of ['B', 'C'] as const) {
    if (!existsSync(armBin(arm))) throw new Error(`arm ${arm} has no engine at ${armBin(arm)} — run freeze.sh first`);
    const version = run(armBin(arm), ['--version'], HARNESS);
    process.stdout.write(`arm ${arm}: ${armBin(arm)} → ${version.stdout.trim()}\n`);
  }

  const expectations = parse(readFileSync(join(HARNESS, 'expectations.yaml'), 'utf8')) as Expectations;
  mkdirSync(RESULTS, {recursive: true});
  // A re-run must not inherit the previous run's row workspaces. With `--only`,
  // only the selected rows' workspaces are discarded.
  if (only === null) {
    rmSync(SCRATCH, {recursive: true, force: true});
  } else {
    for (const id of only) for (const arm of ['B', 'C'] as const) rmSync(join(SCRATCH, `${id}-${arm}`), {recursive: true, force: true});
  }
  mkdirSync(SCRATCH, {recursive: true});

  const previousPath = join(RESULTS, 'sidetable.json');
  const previous: Record<string, RowResult> = {};
  if (only !== null && existsSync(previousPath)) {
    for (const row of (JSON.parse(readFileSync(previousPath, 'utf8')) as {rows?: RowResult[]}).rows ?? []) previous[row.id] = row;
  }

  const rows: RowResult[] = [];
  for (const row of expectations.rows) {
    if (only !== null && !only.has(row.id)) {
      const carried = previous[row.id];
      if (carried !== undefined) rows.push(carried);
      continue;
    }

    if (row.mode === 'manual') {
      rows.push({
        id: row.id,
        fixtureFamily: row.fixture_family,
        question: row.title,
        b: 'manual',
        c: 'manual',
        expectation: JSON.stringify(row.expect),
        verdict: 'not run — manual recipe, see expectations.yaml',
        observations: [],
      });
      continue;
    }

    const observations: Observation[] = [];
    let verdict = 'recorded — classify by hand while the expectations are unlocked';
    for (const step of row.steps ?? []) {
      for (const arm of step.arms) {
        try {
          observations.push(runStep(row, step, arm));
        } catch (error) {
          verdict = `error — ${String(error instanceof Error ? error.message : error)}`;
        }
      }
    }
    rows.push({
      id: row.id,
      fixtureFamily: row.fixture_family,
      question: row.title,
      b: summarise(observations, 'B'),
      c: summarise(observations, 'C'),
      expectation: JSON.stringify(row.expect),
      verdict,
      observations,
    });
  }

  // Once the file is locked the verdict column stops being an instruction to a
  // human and becomes the lock's own answer: the classification the row was
  // locked with, or the difference that broke it.
  const mismatches = expectations.status === 'locked' ? checkLock(expectations, rows) : [];
  const classifications = new Map(expectations.rows.map((r) => [r.id, r.classification ?? 'unclassified']));
  const rendered = expectations.status === 'locked'
    ? rows.map((r) => {
        const mine = mismatches.filter((m) => m.startsWith(`${r.id} `) || m.startsWith(`${r.id}:`));
        return {...r, verdict: mine.length === 0 ? `locked · ${classifications.get(r.id) ?? 'unclassified'}` : `MISMATCH — ${mine.join('; ')}`};
      })
    : rows;

  const table = {generatedAt: new Date().toISOString(), status: expectations.status, rows: rendered};
  writeFileSync(join(RESULTS, 'sidetable.json'), `${JSON.stringify(table, null, 2)}\n`);

  const md = [
    `# Deterministic side-table (${table.generatedAt})`,
    '',
    `Expectations file status: **${expectations.status}**.`,
    '',
    '| Row | Fixture family | Question | B (0.9.4) | C (0.10.0) | Verdict |',
    '|---|---|---|---|---|---|',
    ...rendered.map((r) => `| ${r.id} | ${r.fixtureFamily} | ${r.question} | ${r.b} | ${r.c} | ${r.verdict} |`),
    '',
  ].join('\n');
  writeFileSync(join(RESULTS, 'sidetable.md'), `${md}\n`);
  process.stdout.write(md);

  // The mismatch file describes THIS run, so it is rewritten on every run —
  // including the unlocked case, where there is nothing to mismatch against.
  // Presence means "the last run found differences"; a leftover from an older
  // run would make a clean table read as broken.
  const mismatchPath = join(RESULTS, 'sidetable-mismatches.txt');
  if (mismatches.length > 0) writeFileSync(mismatchPath, `${mismatches.join('\n')}\n`);
  else rmSync(mismatchPath, {force: true});

  if (expectations.status === 'locked') {
    if (mismatches.length > 0) {
      process.stderr.write(`\nthe locked side-table does not match what this run saw:\n${mismatches.map((m) => `  · ${m}`).join('\n')}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`\nlocked table: every pinned exit, byte count and literal still holds (${expectations.rows.length} rows).\n`);
    }
  }
}

main();
