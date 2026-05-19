// Cladding · L1 conformance runner — per ironclad/conformance/level-1.md
//
// Sweeps 12 fixtures (6 stages × {pass, fail}) and asserts each stage's
// signal matches the spec's expected outcome. Fixtures are materialized
// in fresh temp directories so they never collide with cladding's own
// source tree and so the self-dogfood pipeline stays uncontaminated.
//
// Exit codes:
//   0  every fixture matched its expected pass/fail signal
//   1  at least one fixture diverged
//   2  setup failure (filesystem/git)

import {execaSync} from 'execa';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

import {appendEvidence} from '../src/hitl/audit.js';
import {newEvidence} from '../src/hitl/identity.js';
import {runArch} from '../src/stages/arch.js';
import {runAudit} from '../src/stages/audit.js';
import {runCommit} from '../src/stages/commit.js';
import {runCov} from '../src/stages/cov.js';
import {runDrift} from '../src/stages/drift.js';
import {runLint} from '../src/stages/lint.js';
import {runPerf} from '../src/stages/perf.js';
import {runSecret} from '../src/stages/secret.js';
import {runSmoke} from '../src/stages/smoke.js';
import {runType} from '../src/stages/type.js';
import {runUat} from '../src/stages/uat.js';
import {runUnit} from '../src/stages/unit.js';
import {runVisual} from '../src/stages/visual.js';
import type {DriftFinding, StageResult} from '../src/stages/types.js';

// Fixtures run in fresh temp dirs without their own node_modules. Symlinking
// cladding's installed devDeps into each fixture lets npx resolve tsc /
// eslint / madge / secretlint locally without a network install. We
// symlink rather than mutate PATH so cladding's own dogfood pipeline isn't
// perturbed by fixture runs.
const CLADDING_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLADDING_NODE_MODULES = join(CLADDING_ROOT, 'node_modules');

function linkNodeModules(fixtureDir: string): void {
  symlinkSync(CLADDING_NODE_MODULES, join(fixtureDir, 'node_modules'), 'dir');
}

/**
 * One conformance fixture — a synthetic project state + the stage runner
 * to invoke + the assertion that closes the loop.
 *
 * The `expectFindings` field (added in v0.2.5 / F-054) extends the
 * original "match pass/fail" assertion with optional drift-finding
 * checks. A TECH_STACK_MISMATCH warn keeps `drift.pass === true`, so
 * pass/fail alone cannot prove the detector fired; `expectFindings`
 * lets a fixture state "drift passed AND a TECH_STACK_MISMATCH warn
 * was present", which is the real assertion we want for detector-
 * specific documentary promotions.
 *
 * Fixtures whose `run` returns a non-drift `StageResult` (Type, Lint,
 * Commit, etc.) leave `expectFindings` unset.
 */
interface ExpectedFinding {
  readonly detector: string;
  readonly severity: 'error' | 'warn' | 'info';
  /** Minimum number of matching findings required. Defaults to 1. */
  readonly minCount?: number;
}

interface Fixture {
  readonly id: string;
  readonly stage: string;
  readonly expectedPass: boolean;
  setup(dir: string): void;
  run(dir: string): StageResult | {pass: boolean; exitCode: number; stage: string};
  readonly expectFindings?: readonly ExpectedFinding[];
}

const PKG_JSON = '{"name":"clad-conf","type":"module"}\n';
const TSCONFIG = JSON.stringify(
  {compilerOptions: {target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, isolatedModules: true, esModuleInterop: true}},
  null,
  2,
);
const ESLINT_CONFIG =
  "import tseslint from 'typescript-eslint';\n" +
  'export default tseslint.config(...tseslint.configs.recommended);\n';
const SECRETLINTRC = JSON.stringify({
  rules: [{id: '@secretlint/secretlint-rule-preset-recommend'}],
});

function writeTs(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, name), body);
}

const fixtures: readonly Fixture[] = [
  // ─── stage_1.1 Type ────────────────────────────────────────────────
  {
    id: 'stage_1.1.pass',
    stage: 'stage_1.1',
    expectedPass: true,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(join(d, 'tsconfig.json'), TSCONFIG);
      writeTs(d, 'valid.ts', 'const x: number = 42;\nexport {x};\n');
    },
    run(d) {
      return runType({cwd: d});
    },
  },
  {
    id: 'stage_1.1.fail',
    stage: 'stage_1.1',
    expectedPass: false,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(join(d, 'tsconfig.json'), TSCONFIG);
      writeTs(d, 'invalid.ts', 'const x: number = "not a number";\nexport {x};\n');
    },
    run(d) {
      return runType({cwd: d});
    },
  },
  // ─── stage_1.2 Lint ────────────────────────────────────────────────
  {
    id: 'stage_1.2.pass',
    stage: 'stage_1.2',
    expectedPass: true,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(join(d, 'eslint.config.js'), ESLINT_CONFIG);
      writeTs(d, 'clean.ts', 'export const x = 1;\n');
    },
    run(d) {
      return runLint({cwd: d});
    },
  },
  {
    id: 'stage_1.2.fail',
    stage: 'stage_1.2',
    expectedPass: false,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(
        join(d, 'eslint.config.js'),
        "import tseslint from 'typescript-eslint';\n" +
          'export default tseslint.config(\n' +
          '  ...tseslint.configs.recommended,\n' +
          "  {rules: {'@typescript-eslint/no-unused-vars': 'error'}}\n" +
          ');\n',
      );
      writeTs(d, 'dirty.ts', 'export const x = 1;\nconst unused = 2;\n');
    },
    run(d) {
      return runLint({cwd: d});
    },
  },
  // ─── stage_1.3 Drift ───────────────────────────────────────────────
  {
    id: 'stage_1.3.pass',
    stage: 'stage_1.3',
    expectedPass: true,
    setup(d) {
      mkdirSync(join(d, 'stages'), {recursive: true});
      mkdirSync(join(d, 'spec'), {recursive: true});
      writeTs(d, 'stages/dummy.ts', 'export const ok = true;\n');
      // Mirror cladding's own schema so META_INTEGRITY passes the structural check.
      writeFileSync(
        join(d, 'spec/schema.json'),
        JSON.stringify({
          required: ['schema', 'project', 'features'],
          properties: {schema: {}, project: {}, features: {}},
        }),
      );
      writeFileSync(
        join(d, 'spec.yaml'),
        'schema: "0.1"\n' +
          'project: {name: f, language: typescript}\n' +
          'features:\n' +
          '  - id: F-001\n' +
          '    title: dummy\n' +
          '    status: done\n' +
          '    modules: [stages/dummy.ts, spec/schema.json]\n' +
          '    acceptance_criteria:\n' +
          '      - id: AC-001\n' +
          '        ears: ubiquitous\n' +
          '        text: dummy passes\n',
      );
    },
    run(d) {
      return runDrift({cwd: d});
    },
  },
  {
    id: 'stage_1.3.fail',
    stage: 'stage_1.3',
    expectedPass: false,
    setup(d) {
      writeFileSync(
        join(d, 'spec.yaml'),
        'schema: "0.1"\n' +
          'project: {name: f, language: typescript}\n' +
          'features:\n' +
          '  - id: F-001\n' +
          '    title: missing\n' +
          '    status: done\n' +
          '    modules: [nonexistent.ts]\n' +
          '    acceptance_criteria:\n' +
          '      - id: AC-001\n' +
          '        ears: ubiquitous\n' +
          '        text: refers to a missing module\n',
      );
    },
    run(d) {
      return runDrift({cwd: d});
    },
  },
  // ─── stage_1.4 Commit ──────────────────────────────────────────────
  {
    id: 'stage_1.4.pass',
    stage: 'stage_1.4',
    expectedPass: true,
    setup(d) {
      execaSync('git', ['init', '-q'], {cwd: d});
      execaSync('git', ['config', 'user.email', 'c@l'], {cwd: d});
      execaSync('git', ['config', 'user.name', 'c'], {cwd: d});
      writeFileSync(join(d, 'README'), 'ok\n');
      execaSync('git', ['add', '.'], {cwd: d});
      execaSync('git', ['commit', '-q', '-m', 'init'], {cwd: d});
    },
    run(d) {
      return runCommit({cwd: d});
    },
  },
  {
    id: 'stage_1.4.fail',
    stage: 'stage_1.4',
    expectedPass: false,
    setup(d) {
      execaSync('git', ['init', '-q'], {cwd: d});
      execaSync('git', ['config', 'user.email', 'c@l'], {cwd: d});
      execaSync('git', ['config', 'user.name', 'c'], {cwd: d});
      writeFileSync(join(d, 'README'), 'ok\n');
      execaSync('git', ['add', '.'], {cwd: d});
      execaSync('git', ['commit', '-q', '-m', 'init'], {cwd: d});
      writeFileSync(join(d, 'README'), 'dirty\n');
    },
    run(d) {
      return runCommit({cwd: d});
    },
  },
  // ─── stage_1.5 Arch ────────────────────────────────────────────────
  {
    id: 'stage_1.5.pass',
    stage: 'stage_1.5',
    expectedPass: true,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeTs(d, 'a.ts', 'export const a = 1;\n');
      writeTs(d, 'b.ts', "import {a} from './a.js';\nexport const b = a + 1;\n");
    },
    run(d) {
      return runArch({cwd: d});
    },
  },
  {
    id: 'stage_1.5.fail',
    stage: 'stage_1.5',
    expectedPass: false,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeTs(d, 'a.ts', "import {b} from './b.js';\nexport const a = b + 1;\n");
      writeTs(d, 'b.ts', "import {a} from './a.js';\nexport const b = a + 1;\n");
    },
    run(d) {
      return runArch({cwd: d});
    },
  },
  // ─── stage_1.6 Secret ──────────────────────────────────────────────
  {
    id: 'stage_1.6.pass',
    stage: 'stage_1.6',
    expectedPass: true,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(join(d, '.secretlintrc.json'), SECRETLINTRC);
      writeFileSync(join(d, 'README'), 'all clean\n');
    },
    run(d) {
      return runSecret({cwd: d});
    },
  },
  {
    id: 'stage_1.6.fail',
    stage: 'stage_1.6',
    expectedPass: false,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(join(d, '.secretlintrc.json'), SECRETLINTRC);
      // Synthetic Stripe-live-key shape — preset-recommend fires
      // deterministically; AWS / GitHub example shapes are allow-listed.
      writeFileSync(
        join(d, 'leak.js'),
        'export const k = "sk_live_51KX9p0H9PJfgY8wTPxQ7Yh3aGzJWXfYqXM7gWNqLA0BR9zKfXP1zXqXKfXp1zX";\n',
      );
    },
    run(d) {
      return runSecret({cwd: d});
    },
  },
  // ─── stage_2.1 Unit ────────────────────────────────────────────────
  {
    id: 'stage_2.1.pass',
    stage: 'stage_2.1',
    expectedPass: true,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(
        join(d, 'a.test.ts'),
        "import {test, expect} from 'vitest';\ntest('ok', () => expect(1).toBe(1));\n",
      );
    },
    run(d) {
      return runUnit({cwd: d});
    },
  },
  {
    id: 'stage_2.1.fail',
    stage: 'stage_2.1',
    expectedPass: false,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(
        join(d, 'a.test.ts'),
        "import {test, expect} from 'vitest';\ntest('intentional fail', () => expect(1).toBe(2));\n",
      );
    },
    run(d) {
      return runUnit({cwd: d});
    },
  },
  // ─── stage_2.2 Cov ─────────────────────────────────────────────────
  // Use a minimal pass case (vitest with coverage reports clean exit
  // even at 0% by default). Fail case: vitest exits non-zero when no
  // tests are found AND --passWithNoTests is omitted.
  {
    id: 'stage_2.2.pass',
    stage: 'stage_2.2',
    expectedPass: true,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(
        join(d, 'a.test.ts'),
        "import {test, expect} from 'vitest';\ntest('ok', () => expect(1).toBe(1));\n",
      );
    },
    run(d) {
      return runCov({cwd: d});
    },
  },
  {
    id: 'stage_2.2.fail',
    stage: 'stage_2.2',
    expectedPass: false,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(
        join(d, 'a.test.ts'),
        "import {test, expect} from 'vitest';\ntest('intentional fail', () => expect(1).toBe(2));\n",
      );
    },
    run(d) {
      return runCov({cwd: d});
    },
  },
  // ─── stage_3.1 Smoke ───────────────────────────────────────────────
  {
    id: 'stage_3.1.pass',
    stage: 'stage_3.1',
    expectedPass: true,
    setup(d) {
      writeFileSync(
        join(d, 'package.json'),
        '{"name":"f","type":"module","scripts":{"smoke":"node -e \\"process.exit(0)\\""}}\n',
      );
    },
    run(d) {
      return runSmoke({cwd: d});
    },
  },
  {
    id: 'stage_3.1.fail',
    stage: 'stage_3.1',
    expectedPass: false,
    setup(d) {
      writeFileSync(
        join(d, 'package.json'),
        '{"name":"f","type":"module","scripts":{"smoke":"node -e \\"process.exit(1)\\""}}\n',
      );
    },
    run(d) {
      return runSmoke({cwd: d});
    },
  },
  // ─── stage_3.2 Perf ────────────────────────────────────────────────
  {
    id: 'stage_3.2.pass',
    stage: 'stage_3.2',
    expectedPass: true,
    setup(d) {
      writeFileSync(
        join(d, 'package.json'),
        '{"name":"f","type":"module","scripts":{"perf":"node -e \\"process.exit(0)\\""}}\n',
      );
    },
    run(d) {
      return runPerf({cwd: d});
    },
  },
  {
    id: 'stage_3.2.fail',
    stage: 'stage_3.2',
    expectedPass: false,
    setup(d) {
      writeFileSync(
        join(d, 'package.json'),
        '{"name":"f","type":"module","scripts":{"perf":"node -e \\"process.exit(1)\\""}}\n',
      );
    },
    run(d) {
      return runPerf({cwd: d});
    },
  },
  // ─── stage_3.3 Visual ──────────────────────────────────────────────
  {
    id: 'stage_3.3.pass',
    stage: 'stage_3.3',
    expectedPass: true,
    setup(d) {
      writeFileSync(
        join(d, 'package.json'),
        '{"name":"f","type":"module","scripts":{"visual":"node -e \\"process.exit(0)\\""}}\n',
      );
    },
    run(d) {
      return runVisual({cwd: d});
    },
  },
  {
    id: 'stage_3.3.fail',
    stage: 'stage_3.3',
    expectedPass: false,
    setup(d) {
      writeFileSync(
        join(d, 'package.json'),
        '{"name":"f","type":"module","scripts":{"visual":"node -e \\"process.exit(1)\\""}}\n',
      );
    },
    run(d) {
      return runVisual({cwd: d});
    },
  },
  // ─── stage_4.1 Audit ───────────────────────────────────────────────
  {
    id: 'stage_4.1.pass',
    stage: 'stage_4.1',
    expectedPass: true,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      appendEvidence(
        d,
        newEvidence({
          featureId: 'F-001',
          acId: 'AC-001',
          stage: 'stage_4.1',
          kind: 'pass',
          content: 'manual verification',
          identity: {author: 'human', name: 'fixture'},
        }),
      );
    },
    run(d) {
      return runAudit({cwd: d});
    },
  },
  {
    id: 'stage_4.1.fail',
    stage: 'stage_4.1',
    expectedPass: false,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      // Only LLM evidence → anti-self-cert guard blocks.
      appendEvidence(
        d,
        newEvidence({
          featureId: 'F-001',
          acId: 'AC-001',
          stage: 'stage_4.1',
          kind: 'pass',
          content: 'LLM-generated check',
          identity: {author: 'llm', name: 'claude-opus-4.7'},
        }),
      );
    },
    run(d) {
      return runAudit({cwd: d});
    },
  },
  // ─── stage_4.2 UAT ─────────────────────────────────────────────────
  {
    id: 'stage_4.2.pass',
    stage: 'stage_4.2',
    expectedPass: true,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(
        join(d, 'spec.yaml'),
        'schema: "0.1"\n' +
          'project: {name: f, language: typescript}\n' +
          'features:\n' +
          '  - id: F-001\n' +
          '    title: t\n' +
          '    status: done\n',
      );
      appendEvidence(
        d,
        newEvidence({
          featureId: 'F-001',
          stage: 'stage_4.2',
          kind: 'pass',
          content: 'human accepted',
          identity: {author: 'human', name: 'fixture'},
        }),
      );
    },
    run(d) {
      return runUat({cwd: d});
    },
  },
  {
    id: 'stage_4.2.fail',
    stage: 'stage_4.2',
    expectedPass: false,
    setup(d) {
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(
        join(d, 'spec.yaml'),
        'schema: "0.1"\n' +
          'project: {name: f, language: typescript}\n' +
          'features:\n' +
          '  - id: F-001\n' +
          '    title: t\n' +
          '    status: done\n',
      );
      // Tool evidence only — no human pass → UAT fails.
      appendEvidence(
        d,
        newEvidence({
          featureId: 'F-001',
          stage: 'stage_4.2',
          kind: 'pass',
          content: 'CI ran',
          identity: {author: 'tool', name: 'ci'},
        }),
      );
    },
    run(d) {
      return runUat({cwd: d});
    },
  },

  // ─── Documentary → runnable promotion · batch 1 (v0.2.5 / F-054) ──────
  // Each entry was kind: documentary in fixtures.yaml until this batch
  // promoted it. Naming preserves the F-NNN_AC-MMM scheme so registry
  // entries do not need to be renamed during promotion — only the
  // `kind` field changes.

  {
    // F-007/AC-011 — Commit stage when cwd is not a git repository.
    // Dir without `.git` triggers runCommit's git-unavailable branch,
    // returning exitCode=2 so callers treat the stage as skipped.
    id: 'F-007_AC-011',
    stage: 'stage_1.4',
    expectedPass: false,
    setup(_d) {
      // intentionally empty — absence of .git is the assertion
    },
    run(d) {
      return runCommit({cwd: d});
    },
  },
  {
    // F-011/AC-018 — MISSING_IMPLEMENTATION info finding when spec.yaml
    // is absent. The detector emits one info-severity finding rather
    // than failing the stage; drift overall remains pass=true because
    // info < error.
    id: 'F-011_AC-018',
    stage: 'stage_1.3',
    expectedPass: true,
    setup(d) {
      // No spec.yaml on purpose; mirror schema.json so META_INTEGRITY
      // does not separately complain.
      mkdirSync(join(d, 'spec'), {recursive: true});
      writeFileSync(
        join(d, 'spec/schema.json'),
        JSON.stringify({
          required: ['schema', 'project', 'features'],
          properties: {schema: {}, project: {}, features: {}},
        }),
      );
    },
    run(d) {
      return runDrift({cwd: d});
    },
    expectFindings: [{detector: 'MISSING_IMPLEMENTATION', severity: 'info'}],
  },
  {
    // F-012/AC-020 — UNMAPPED_ARTIFACT info finding when spec.yaml is
    // absent. Same setup as F-011/AC-018; both detectors emit info
    // findings from the same shared error surface.
    id: 'F-012_AC-020',
    stage: 'stage_1.3',
    expectedPass: true,
    setup(d) {
      mkdirSync(join(d, 'spec'), {recursive: true});
      writeFileSync(
        join(d, 'spec/schema.json'),
        JSON.stringify({
          required: ['schema', 'project', 'features'],
          properties: {schema: {}, project: {}, features: {}},
        }),
      );
    },
    run(d) {
      return runDrift({cwd: d});
    },
    expectFindings: [{detector: 'UNMAPPED_ARTIFACT', severity: 'info'}],
  },
  {
    // F-013/AC-021 — TECH_STACK_MISMATCH warn when spec.project.language
    // differs from what the toolchain detection chain returns. The warn
    // does not fail drift (default severity is warn, not error), so
    // pass remains true; the assertion is on the finding shape.
    //
    // The fixture writes `.secretlintrc.json` because adding package.json
    // makes the toolchain pick TypeScript, which makes HARDCODED_SECRET
    // try to invoke secretlint via npx — without a config file the
    // scanner exits non-zero and emits an error finding that would mask
    // the warn we are actually probing for.
    id: 'F-013_AC-021',
    stage: 'stage_1.3',
    expectedPass: true,
    setup(d) {
      mkdirSync(join(d, 'stages'), {recursive: true});
      mkdirSync(join(d, 'spec'), {recursive: true});
      writeTs(d, 'stages/dummy.ts', '// fixture stub\nexport const ok = true;\n');
      writeFileSync(join(d, 'package.json'), PKG_JSON);
      writeFileSync(join(d, '.secretlintrc.json'), SECRETLINTRC);
      writeFileSync(
        join(d, 'spec/schema.json'),
        JSON.stringify({
          required: ['schema', 'project', 'features'],
          properties: {schema: {}, project: {}, features: {}},
        }),
      );
      // spec.project.language = python, but package.json + .ts source
      // make the toolchain resolve to typescript → mismatch.
      writeFileSync(
        join(d, 'spec.yaml'),
        'schema: "0.1"\n' +
          'project: {name: f, language: python}\n' +
          'features:\n' +
          '  - id: F-001\n' +
          '    title: t\n' +
          '    status: done\n' +
          '    modules: [stages/dummy.ts, spec/schema.json]\n' +
          '    acceptance_criteria:\n' +
          '      - id: AC-001\n' +
          '        ears: ubiquitous\n' +
          '        text: declared python; tree is TS\n' +
          '        evidence_refs: [fixture:F-013_AC-021]\n',
      );
    },
    run(d) {
      return runDrift({cwd: d});
    },
    expectFindings: [{detector: 'TECH_STACK_MISMATCH', severity: 'warn'}],
  },
  {
    // F-014/AC-022 — STATUS_DRIFT error when a status=done feature
    // declares a module that does not exist on disk. The error fails
    // the drift stage; assertion uses both pass=false and the finding.
    id: 'F-014_AC-022',
    stage: 'stage_1.3',
    expectedPass: false,
    setup(d) {
      writeFileSync(
        join(d, 'spec.yaml'),
        'schema: "0.1"\n' +
          'project: {name: f, language: typescript}\n' +
          'features:\n' +
          '  - id: F-001\n' +
          '    title: phantom\n' +
          '    status: done\n' +
          '    modules: [nonexistent-on-purpose.ts]\n' +
          '    acceptance_criteria:\n' +
          '      - id: AC-001\n' +
          '        ears: ubiquitous\n' +
          '        text: status=done with missing module\n',
      );
    },
    run(d) {
      return runDrift({cwd: d});
    },
    expectFindings: [{detector: 'STATUS_DRIFT', severity: 'error'}],
  },
  {
    // F-014/AC-023 — STATUS_DRIFT warn when a status=in_progress
    // feature declares modules but every one is absent. The detector
    // emits warn (less severe than the AC-022 done-with-missing case);
    // however MISSING_IMPLEMENTATION is status-blind and still fires
    // error on the same absent modules, so drift ultimately fails.
    // The fixture's assertion is that the STATUS_DRIFT warn is
    // present alongside the louder error, not that drift passes.
    id: 'F-014_AC-023',
    stage: 'stage_1.3',
    expectedPass: false,
    setup(d) {
      mkdirSync(join(d, 'spec'), {recursive: true});
      writeFileSync(
        join(d, 'spec/schema.json'),
        JSON.stringify({
          required: ['schema', 'project', 'features'],
          properties: {schema: {}, project: {}, features: {}},
        }),
      );
      writeFileSync(
        join(d, 'spec.yaml'),
        'schema: "0.1"\n' +
          'project: {name: f, language: typescript}\n' +
          'features:\n' +
          '  - id: F-001\n' +
          '    title: in flight\n' +
          '    status: in_progress\n' +
          '    modules: [planned-but-absent.ts, also-absent.ts]\n' +
          '    acceptance_criteria:\n' +
          '      - id: AC-001\n' +
          '        ears: ubiquitous\n' +
          '        text: in_progress with all modules absent\n' +
          '        evidence_refs: [fixture:F-014_AC-023]\n',
      );
    },
    run(d) {
      return runDrift({cwd: d});
    },
    expectFindings: [{detector: 'STATUS_DRIFT', severity: 'warn'}],
  },
  {
    // F-019/AC-029 — AC_DRIFT error when an AC has neither a rendered
    // `text` field nor any EARS structural fields (condition / action
    // / response). The detector classifies this as error (a structural
    // bug, not a soft warning), so drift fails. Fixture asserts both
    // the failure and the specific finding.
    id: 'F-019_AC-029',
    stage: 'stage_1.3',
    expectedPass: false,
    setup(d) {
      mkdirSync(join(d, 'stages'), {recursive: true});
      mkdirSync(join(d, 'spec'), {recursive: true});
      writeTs(d, 'stages/dummy.ts', '// fixture stub\nexport const ok = true;\n');
      writeFileSync(
        join(d, 'spec/schema.json'),
        JSON.stringify({
          required: ['schema', 'project', 'features'],
          properties: {schema: {}, project: {}, features: {}},
        }),
      );
      writeFileSync(
        join(d, 'spec.yaml'),
        'schema: "0.1"\n' +
          'project: {name: f, language: typescript}\n' +
          'features:\n' +
          '  - id: F-001\n' +
          '    title: t\n' +
          '    status: done\n' +
          '    modules: [stages/dummy.ts, spec/schema.json]\n' +
          '    acceptance_criteria:\n' +
          '      - id: AC-001\n',
      );
    },
    run(d) {
      return runDrift({cwd: d});
    },
    expectFindings: [{detector: 'AC_DRIFT', severity: 'error'}],
  },
];

interface RunOutcome {
  readonly fixture: string;
  readonly stage: string;
  readonly expectedPass: boolean;
  readonly actualPass: boolean;
  readonly exitCode: number;
  readonly matched: boolean;
  readonly findingsMatched?: boolean;
  readonly missingFindings?: readonly string[];
}

interface ResultWithFindings {
  readonly pass: boolean;
  readonly exitCode: number;
  readonly findings?: readonly DriftFinding[];
}

function checkFindings(
  result: ResultWithFindings,
  expected: readonly ExpectedFinding[],
): {matched: boolean; missing: string[]} {
  const missing: string[] = [];
  const findings = result.findings ?? [];
  for (const want of expected) {
    const count = findings.filter(
      (f) => f.detector === want.detector && f.severity === want.severity,
    ).length;
    const minCount = want.minCount ?? 1;
    if (count < minCount) {
      missing.push(`${want.detector}/${want.severity} (saw ${count}, need ${minCount})`);
    }
  }
  return {matched: missing.length === 0, missing};
}

function runOne(fixture: Fixture): RunOutcome {
  const dir = mkdtempSync(join(tmpdir(), `clad-conf-${fixture.id.replace(/\./g, '_')}-`));
  try {
    linkNodeModules(dir);
    fixture.setup(dir);
    const result = fixture.run(dir) as ResultWithFindings;
    const passMatched = result.pass === fixture.expectedPass;
    if (fixture.expectFindings && fixture.expectFindings.length > 0) {
      const fcheck = checkFindings(result, fixture.expectFindings);
      return {
        fixture: fixture.id,
        stage: fixture.stage,
        expectedPass: fixture.expectedPass,
        actualPass: result.pass,
        exitCode: result.exitCode,
        matched: passMatched && fcheck.matched,
        findingsMatched: fcheck.matched,
        missingFindings: fcheck.missing.length > 0 ? fcheck.missing : undefined,
      };
    }
    return {
      fixture: fixture.id,
      stage: fixture.stage,
      expectedPass: fixture.expectedPass,
      actualPass: result.pass,
      exitCode: result.exitCode,
      matched: passMatched,
    };
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

const outcomes = fixtures.map(runOne);
const allMatched = outcomes.every((o) => o.matched);

function declaredLevel(matched: boolean): 'L0' | 'L1' | 'L2' | 'L3' | 'L4' {
  if (!matched) return 'L0';
  return 'L4';
}

const report = {
  conformance: 'level-1-to-4',
  total: outcomes.length,
  matched: outcomes.filter((o) => o.matched).length,
  diverged: outcomes.filter((o) => !o.matched),
  result: allMatched ? 'pass' : 'fail',
  iron_law: declaredLevel(allMatched),
  outcomes,
};

console.log(JSON.stringify(report, null, 2));
process.exit(allMatched ? 0 : 1);
