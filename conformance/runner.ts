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

import {runArch} from '../stages/arch.js';
import {runCommit} from '../stages/commit.js';
import {runDrift} from '../stages/drift.js';
import {runLint} from '../stages/lint.js';
import {runSecret} from '../stages/secret.js';
import {runType} from '../stages/type.js';
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
      // Synthetic PEM block — preset-recommend's `privatekey` rule fires
      // on the BEGIN/END markers regardless of body validity. Chosen over
      // AWS/GitHub patterns because those have allow-listed example forms.
      // Synthetic Stripe-live-key shape. preset-recommend's stripe rule
      // matches sk_live_ + 60+ alphanumerics. The body is random padding,
      // not a real key — verified by Stripe's own example warning policy
      // (example keys begin with `sk_test_` or appear in their docs).
      writeFileSync(
        join(d, 'leak.js'),
        'export const k = "sk_live_51KX9p0H9PJfgY8wTPxQ7Yh3aGzJWXfYqXM7gWNqLA0BR9zKfXP1zXqXKfXp1zX";\n',
      );
    },
    run(d) {
      return runSecret({cwd: d});
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

const report = {
  conformance: 'level-1',
  total: outcomes.length,
  matched: outcomes.filter((o) => o.matched).length,
  diverged: outcomes.filter((o) => !o.matched),
  result: allMatched ? 'pass' : 'fail',
  iron_law: allMatched ? 'L1' : 'L0',
  outcomes,
};

console.log(JSON.stringify(report, null, 2));
process.exit(allMatched ? 0 : 1);
