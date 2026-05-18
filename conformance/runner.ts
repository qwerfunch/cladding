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

import {appendEvidence} from '../hitl/audit.js';
import {newEvidence} from '../hitl/identity.js';
import {runArch} from '../stages/arch.js';
import {runAudit} from '../stages/audit.js';
import {runCommit} from '../stages/commit.js';
import {runCov} from '../stages/cov.js';
import {runDrift} from '../stages/drift.js';
import {runLint} from '../stages/lint.js';
import {runPerf} from '../stages/perf.js';
import {runSecret} from '../stages/secret.js';
import {runSmoke} from '../stages/smoke.js';
import {runType} from '../stages/type.js';
import {runUat} from '../stages/uat.js';
import {runUnit} from '../stages/unit.js';
import {runVisual} from '../stages/visual.js';
import type {StageResult} from '../stages/types.js';

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

interface Fixture {
  readonly id: string;
  readonly stage: string;
  readonly expectedPass: boolean;
  setup(dir: string): void;
  run(dir: string): StageResult | {pass: boolean; exitCode: number; stage: string};
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
];

interface RunOutcome {
  readonly fixture: string;
  readonly stage: string;
  readonly expectedPass: boolean;
  readonly actualPass: boolean;
  readonly exitCode: number;
  readonly matched: boolean;
}

function runOne(fixture: Fixture): RunOutcome {
  const dir = mkdtempSync(join(tmpdir(), `clad-conf-${fixture.id.replace(/\./g, '_')}-`));
  try {
    linkNodeModules(dir);
    fixture.setup(dir);
    const result = fixture.run(dir);
    return {
      fixture: fixture.id,
      stage: fixture.stage,
      expectedPass: fixture.expectedPass,
      actualPass: result.pass,
      exitCode: result.exitCode,
      matched: result.pass === fixture.expectedPass,
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
