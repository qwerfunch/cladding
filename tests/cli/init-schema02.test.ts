// Cladding · `clad init` scaffolds schema 0.2 natively (F-c4df5fb4).
//
// A new adopter must land on the current schema without running a migration,
// so these tests read what init actually wrote and hand it to the real
// compiler: a scaffold that only *looks* like schema 0.2 would pass a string
// assertion and fail the first gate. The legacy seed is pinned byte-for-byte,
// because `--schema 0.1` exists precisely to change nothing.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

// The scaffold under test carries no toolchain, so the stage runners are inert:
// whether a developer happens to have tsc or eslint installed must not decide
// whether a fresh workspace is green. Drift, the spec-native stage, stays real.
vi.mock('../../src/stages/type.js', () => ({runType: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/lint.js', () => ({runLint: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/arch.js', () => ({runArch: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: () => ({pass: true, exitCode: 0})}));

import {runCheckStages} from '../../src/cli/clad.js';
import {renderHostDraft} from '../../src/cli/host-onboarding.js';
import {runInit} from '../../src/cli/init.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';

/** The schema 0.1 seed exactly as it shipped before the 0.2 default. */
function legacySeed(projectName: string): string {
  return [
    '# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual',
    `# ${projectName} — Cladding spec`,
    '# Features live in spec/features/<slug>-<hash8>.yaml — one file per feature.',
    '# Edit shards there, run `clad sync` to validate, `clad check` to exercise',
    '# every Iron Law stage. See https://github.com/qwerfunch/ironclad for the standard.',
    '',
    'schema: "0.1"',
    '',
    'project:',
    `  name: ${projectName}`,
    '  language: typescript',
    '  onboarding_seeded: true',
    '  version: "0.0.1"',
    '',
    'features: []',
    '',
  ].join('\n');
}

const HOST_DRAFT = {
  mode: 'greenfield',
  project_context: {why: 'Because', problem: 'A problem', purpose: 'A purpose'},
  capabilities: [{id: 'pay', title: 'Payments', summary: 'Takes money', surface: 'feature'}],
  architecture: {layers: [{name: 'core', forbidden_imports: []}]},
  scenarios: [{slug: 'pay-once', title: 'Pay once', flow: 'open\npay'}],
  questions: [],
} as const;

describe('schema 0.2 native onboarding', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-init-02-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-c4df5fb4/AC-7e4895e2] a scaffold without a legacy flag declares schema 0.2, a purpose, and both policies', async () => {
    const result = await runInit({cwd: dir});

    expect(result.schema).toBe('0.2');
    const seed = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    expect(seed).toContain('schema: "0.2"');
    expect(seed).toContain(`purpose: "${basename(dir)} exists to be refined with clad clarify"`);
    expect(seed).toContain('assurance_level: L2');
    expect(seed).toContain('scenario_policy: advisory');
    // Schema 0.2 reads feature files, and rejects an inline root list.
    expect(seed).not.toContain('features:');
    expect(compileSpecWorkspace(dir).diagnostics.filter((d) => d.severity === 'blocking')).toEqual([]);
  });

  test('[covers:F-c4df5fb4/AC-7e4895e2] a stated intent becomes the seeded purpose instead of the placeholder', async () => {
    await runInit({cwd: dir, intent: 'Settle invoices between small studios.', noLlm: true});

    const seed = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    expect(seed).toContain('purpose: "Settle invoices between small studios."');
    expect(seed).toContain('description: "Settle invoices between small studios."');
    // The legacy `intent_summary` field has no home in schema 0.2.
    expect(seed).not.toContain('intent_summary');
  });

  test('[covers:F-c4df5fb4/AC-672da65e] the catalog and architecture files land in their schema 0.2 shapes without a legacy marker', async () => {
    await runInit({cwd: dir});

    const capabilities = readFileSync(join(dir, 'spec', 'capabilities.yaml'), 'utf8');
    const architecture = readFileSync(join(dir, 'spec', 'architecture.yaml'), 'utf8');
    expect(capabilities).toContain('capabilities: []');
    expect(capabilities).not.toContain('schema: "0.1"');
    expect(capabilities).not.toMatch(/^source:/m);
    expect(architecture).toContain('layers: []');
    expect(architecture).toContain('rules: []');
    expect(architecture).not.toContain('schema: "0.1"');
    // The compiler is the authority on the shape, not the strings above.
    expect(compileSpecWorkspace(dir).diagnostics.filter((d) => d.severity === 'blocking')).toEqual([]);
  });

  test('[covers:F-c4df5fb4/AC-672da65e] adopting an existing codebase converts the observed bodies into the canonical catalog', async () => {
    mkdirSync(join(dir, 'src', 'cli'), {recursive: true});
    mkdirSync(join(dir, 'src', 'core'), {recursive: true});
    writeFileSync(join(dir, 'src', 'cli', 'command.ts'), 'export const command = true;\n');
    writeFileSync(join(dir, 'src', 'core', 'service.ts'), 'export const service = true;\n');
    writeFileSync(join(dir, 'README.md'), '# Demo\n\n## Checkout\n');

    await runInit({cwd: dir, scan: true, noLlm: true});

    // The canonical file is the schema 0.2 contract, carrying the layers the
    // scan actually saw — nothing invented, nothing the compiler rejects.
    const architecture = readFileSync(join(dir, 'spec', 'architecture.yaml'), 'utf8');
    expect(architecture).toContain('rules: []');
    expect(architecture).toMatch(/^layers:\n  - \[.*cli.*\]$/m);
    expect(compileSpecWorkspace(dir).diagnostics.filter((d) => d.severity === 'blocking')).toEqual([]);
    // What the scanner observed reaches the canonical catalog rather than a
    // proposal nobody reads: an adopter would otherwise land on an empty one.
    const capabilities = readFileSync(join(dir, 'spec', 'capabilities.yaml'), 'utf8');
    expect(capabilities).toContain('id: checkout');
    expect(capabilities).toContain('outcome:');
    expect(capabilities).not.toMatch(/^\s+summary:/m);
    expect(existsSync(join(dir, '.cladding', 'scan', 'capabilities.yaml.proposal'))).toBe(false);
  });

  test('[covers:F-c4df5fb4/AC-c366483b] the legacy flag reproduces the schema 0.1 seed byte for byte', async () => {
    const result = await runInit({cwd: dir, schema: '0.1'});

    expect(result.schema).toBe('0.1');
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toBe(legacySeed(basename(dir)));
    // The legacy workspace keeps its own Tier B seeds untouched too.
    expect(readFileSync(join(dir, 'spec', 'capabilities.yaml'), 'utf8')).toContain('schema: "0.1"');
    expect(readFileSync(join(dir, 'spec', 'architecture.yaml'), 'utf8')).not.toContain('rules: []');
  });

  test('[covers:F-c4df5fb4/AC-44fd1b7d] the host onboarding draft drops the legacy schema marker for a schema 0.2 workspace', async () => {
    await runInit({cwd: dir});
    const draft02 = renderHostDraft(HOST_DRAFT, dir);

    expect(draft02).toContain('=== CAPABILITIES_YAML ===');
    expect(draft02).not.toMatch(/^schema:/m);

    const legacy = mkdtempSync(join(tmpdir(), 'clad-init-01-'));
    try {
      await runInit({cwd: legacy, schema: '0.1'});
      expect(renderHostDraft(HOST_DRAFT, legacy)).toMatch(/^schema: "0\.1"$/m);
    } finally {
      rmSync(legacy, {recursive: true, force: true});
    }
  });

  test('[covers:F-c4df5fb4/AC-bd69438e] a fresh schema 0.2 scaffold runs the checkpoint profile green with no migration baseline', async () => {
    await runInit({cwd: dir});

    const origin = process.cwd();
    process.chdir(dir);
    let verdict: ReturnType<typeof runCheckStages>;
    try {
      verdict = runCheckStages({profile: 'checkpoint', silent: true});
    } finally {
      process.chdir(origin);
    }

    expect(verdict.worst).toBe(0);
    expect(verdict.anyFailed).toBeFalsy();
    expect(existsSync(join(dir, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'))).toBe(false);
  });
});
