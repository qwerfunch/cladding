// Cladding · Spec 0.2 F2 · public read-only migration command tests.

import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

import {runMigrateCommand} from '../../src/cli/migrate.js';
import {selectCriterionTestBindings} from '../../src/proof/legacy-bindings.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {previewSchema02Migration} from '../../src/spec/compiler/migration-preview.js';
import {editSpec, migrationPreviewDigest, parseSpecEditOperations, readSpecEditRevisions} from '../../src/spec/edit.js';
import {loadSpec} from '../../src/spec/load.js';

const temporary: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-cli-migrate-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: cli\n  language: typescript\n  intent_summary: Keep source faithful.\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'features', 'cli-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: CLI\nstatus: planned\nmodules: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    text: The system shall preview a migration.\n');
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

function workspaceManifest(root: string, directory: string = root): readonly {readonly path: string; readonly bytes: string}[] {
  return readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return workspaceManifest(root, path);
      return [{path: path.slice(root.length + 1), bytes: readFileSync(path).toString('base64')}];
    });
}

/** Leaves a real journaled migration mid-replacement for the public CLI to recover. */
function interruptMigration(root: string): void {
  const operation = migrationOperation(root);
  expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation]), testFaultAfterReplacements: 1})).toThrow('InjectedTransactionFault');
}

/** Builds the explicit decisions that apply this fixture's clean-room upgrade. */
function migrationOperation(root: string) {
  const preview = previewSchema02Migration(root);
  return {
    kind: 'project.upgrade_schema' as const,
    resolutions: {
      previewDigest: migrationPreviewDigest(preview),
      confirmed: preview.requiredResolution.map((item) => item.code === 'PROJECT_LEGACY_L2_BASELINE'
        ? {code: item.code, subject: item.subject, value: 'reject'}
        : item.code === 'ARCHITECTURE_LAYER_RESOLUTION'
          ? {code: item.code, subject: item.subject, value: {layers: [['core']]}}
          : defaultMigrationConfirmation(item)),
    },
  };
}

function strictReviewWorkspace(
  status: 'planned' | 'done' = 'planned',
  resolution: 'unknown' | 'conflict' = 'unknown',
): string {
  const root = workspace();
  mkdirSync(join(root, 'tests'), {recursive: true});
  writeFileSync(join(root, 'tests', 'reviewed.test.ts'), 'it("historic reviewed case", () => {});\n');
  writeFileSync(join(root, 'spec', 'features', 'cli-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'title: CLI', `status: ${status}`, 'modules: []', 'acceptance_criteria:',
    '  - id: AC-bbbbbbbb',
    ...(resolution === 'conflict'
      ? ['    text: The system shall retain an explicitly reviewed historic test input.', '    ears: event']
      : []),
    '    test_refs: [tests/reviewed.test.ts#historic reviewed case]', '',
  ].join('\n'));
  return root;
}

function addKnownSiblingCriterion(root: string): void {
  const feature = join(root, 'spec', 'features', 'cli-aaaaaaaa.yaml');
  writeFileSync(feature, `${readFileSync(feature, 'utf8')}  - id: AC-cccccccc\n    text: The system shall preserve unrelated proof.\n`);
}

function expectNoTransactionResidue(root: string): void {
  expect(existsSync(join(root, '.cladding', 'spec-transaction.json'))).toBe(false);
  expect(existsSync(join(root, '.cladding', 'spec-transaction.lock'))).toBe(false);
}

function defaultMigrationConfirmation(item: {readonly code: string; readonly subject: string}): {readonly code: string; readonly subject: string; readonly value?: unknown} {
  return item.code === 'PROJECT_LEGACY_L2_BASELINE'
    ? {code: item.code, subject: item.subject, value: 'reject'}
    : {code: item.code, subject: item.subject};
}

function strictReviewOperation(root: string, disposition?: 'retain' | 'drop', baselineDecision: 'accept' | 'reject' = 'reject') {
  const preview = previewSchema02Migration(root);
  return {
    kind: 'project.upgrade_schema' as const,
    resolutions: {
      previewDigest: migrationPreviewDigest(preview),
      confirmed: preview.requiredResolution.map((item) => {
        if (item.code === 'PROJECT_LEGACY_L2_BASELINE') return {code: item.code, subject: item.subject, value: baselineDecision};
        if (item.code === 'ARCHITECTURE_LAYER_RESOLUTION') return {code: item.code, subject: item.subject, value: {layers: [['core']]}};
        if (item.code === 'CRITERION_TEXT_UNKNOWN' || item.code === 'CRITERION_STATEMENT_CONFLICT') return {
          code: item.code,
          subject: item.subject,
          value: {
            statement: 'The system shall retain an explicitly reviewed historic test input.',
            kind: 'behavior',
            ...(disposition === undefined ? {} : {testBindingDisposition: disposition}),
            ...(disposition === 'retain' ? {retainedTestRefs: ['tests/reviewed.test.ts#historic reviewed case']} : {}),
          },
        };
        return defaultMigrationConfirmation(item);
      }),
    },
  };
}

/** Produces one valid reviewed decision set that exceeds the agent edit-packet ceiling. */
function oversizedMigrationResolutions(root: string) {
  const preview = previewSchema02Migration(root);
  return {
    previewDigest: migrationPreviewDigest(preview),
    confirmed: preview.requiredResolution.map((item) => {
      if (item.code === 'PROJECT_LEGACY_L2_BASELINE') return {code: item.code, subject: item.subject, value: 'reject'};
      if (item.code === 'PROJECT_PURPOSE_CONFIRMATION') {
        return {code: item.code, subject: item.subject, value: `Reviewed local purpose: ${'p'.repeat(17 * 1024)}`};
      }
      if (item.code === 'ARCHITECTURE_LAYER_RESOLUTION') {
        return {code: item.code, subject: item.subject, value: {layers: [['core']]}};
      }
      return defaultMigrationConfirmation(item);
    }),
  };
}

describe('clad migrate', () => {
  test('[covers:F-14c9d647/AC-6413ee0c] previews schema 0.2 migration without writing', () => {
    const root = workspace();
    const before = workspaceManifest(root);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const result = runMigrateCommand({to: '0.2', cwd: root});
    expect(result.ok).toBe(true);
    expect(workspaceManifest(root)).toEqual(before);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('No files were changed.'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('completed legacy criteria for a separate accept-or-reject baseline decision'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('census digest:'));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('--apply --resolutions <file>'));
    expect(stdout).not.toHaveBeenCalledWith(expect.stringContaining('criterion:F-aaaaaaaa/AC-bbbbbbbb'));
  });

  test('emits a deterministic JSON preview with internal migration details', () => {
    const root = workspace();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const result = runMigrateCommand({to: '0.2', json: true, cwd: root});
    expect(result.output).toContain('criterion:F-aaaaaaaa/AC-bbbbbbbb');
    expect(stdout).toHaveBeenCalledWith(result.output);
  });

  test('rejects an unsupported target without writing', () => {
    const root = workspace();
    const before = workspaceManifest(root);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({to: '0.3', cwd: root})).toEqual({ok: false});
    expect(process.exitCode).toBe(1);
    expect(workspaceManifest(root)).toEqual(before);
  });

  test('[covers:F-14c9d647/AC-6413ee0c] refuses apply without writing', () => {
    const root = workspace();
    const before = workspaceManifest(root);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({to: '0.2', apply: true, cwd: root})).toEqual({ok: false});
    expect(process.exitCode).toBe(1);
    expect(workspaceManifest(root)).toEqual(before);
  });

  test('requires an explicit retain-or-drop disposition for strict historic test carry-forward and persists only retain', () => {
    const missing = strictReviewWorkspace();
    const missingBefore = workspaceManifest(missing);
    const unresolved = strictReviewOperation(missing);
    expect(() => editSpec({cwd: missing, operations: [unresolved], inputRevisions: readSpecEditRevisions(missing, [unresolved])}))
      .toThrow(expect.objectContaining({code: 'MIGRATION_UNRESOLVED'}));
    expect(workspaceManifest(missing)).toEqual(missingBefore);

    const retained = strictReviewWorkspace();
    const retain = strictReviewOperation(retained, 'retain');
    expect(editSpec({cwd: retained, operations: [retain], inputRevisions: readSpecEditRevisions(retained, [retain])}).changed).toBe(true);
    const retainedCompilation = compileSpecWorkspace(retained);
    const current = {statement: 'The system shall retain an explicitly reviewed historic test input.', kind: 'behavior'};
    const retainedSelection = selectCriterionTestBindings({
      cwd: retained, baseline: retainedCompilation.migrationBaseline, criterion: 'F-aaaaaaaa/AC-bbbbbbbb', currentCriterion: current, live: [],
    });
    expect(retainedCompilation.migrationBaseline?.reviewedCarryForwards).toEqual(expect.arrayContaining([
      expect.objectContaining({criterion: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', bindings: [expect.objectContaining({sha256: expect.stringMatching(/^[a-f0-9]{64}$/)})]}),
    ]));
    expect(retainedSelection).toMatchObject({source: 'reviewed', reviewed: [expect.objectContaining({state: 'available', raw: 'tests/reviewed.test.ts#historic reviewed case'})]});
    expect(selectCriterionTestBindings({
      cwd: retained, baseline: retainedCompilation.migrationBaseline, criterion: 'F-aaaaaaaa/AC-bbbbbbbb',
      currentCriterion: {...current, statement: 'The system shall change an unreviewed strict intent.'}, live: [],
    }).source).toBe('none');

    const dropped = strictReviewWorkspace();
    const drop = strictReviewOperation(dropped, 'drop');
    expect(editSpec({cwd: dropped, operations: [drop], inputRevisions: readSpecEditRevisions(dropped, [drop])}).changed).toBe(true);
    const droppedCompilation = compileSpecWorkspace(dropped);
    expect(selectCriterionTestBindings({
      cwd: dropped, baseline: droppedCompilation.migrationBaseline, criterion: 'F-aaaaaaaa/AC-bbbbbbbb', currentCriterion: current, live: [],
    }).source).toBe('none');
    expect(loadSpec(dropped).features[0]?.acceptance_criteria?.[0]?.test_refs).toBeUndefined();
  });

  test('rejects a done criterion that drops historic tests without an exact live title carrier atomically', () => {
    const root = strictReviewWorkspace('done');
    const operation = strictReviewOperation(root, 'drop');
    const before = workspaceManifest(root);

    expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}))
      .toThrow(expect.objectContaining({
        code: 'MIGRATION_UNRESOLVED',
        message: 'Completed criterion F-aaaaaaaa/AC-bbbbbbbb cannot drop historic test inputs without an exact current safe [covers:] title carrier.',
      }));
    expect(workspaceManifest(root)).toEqual(before);
    expectNoTransactionResidue(root);
  });

  test('applies the same atomic guard to a done conflicting criterion', () => {
    const root = strictReviewWorkspace('done', 'conflict');
    const operation = strictReviewOperation(root, 'drop');
    const before = workspaceManifest(root);

    expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}))
      .toThrow(expect.objectContaining({code: 'MIGRATION_UNRESOLVED'}));
    expect(workspaceManifest(root)).toEqual(before);
    expectNoTransactionResidue(root);
  });

  test('allows a done criterion to drop historic tests when F5 harvests its exact live title carrier', () => {
    const root = strictReviewWorkspace('done');
    writeFileSync(join(root, 'tests', 'live.test.ts'), 'it("[covers:F-aaaaaaaa/AC-bbbbbbbb] verifies the migrated criterion", () => {});\n');
    const operation = strictReviewOperation(root, 'drop');

    expect(editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}).changed).toBe(true);
    const testRefs = loadSpec(root).features[0]?.acceptance_criteria?.[0]?.test_refs;
    expect(testRefs).not.toContain('tests/reviewed.test.ts#historic reviewed case');
    expect(testRefs).toContain('tests/live.test.ts#[covers:F-aaaaaaaa/AC-bbbbbbbb] verifies the migrated criterion');
    expect(compileSpecWorkspace(root).migrationBaseline?.reviewedCarryForwards ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({criterion: 'criterion:F-aaaaaaaa/AC-bbbbbbbb'}),
    ]));
    expectNoTransactionResidue(root);
  });

  test.each([
    ['an unrelated same-file test', 'it("checks a separate concern", () => {});\n'],
    ['a bare criterion identifier', 'it("F-aaaaaaaa/AC-bbbbbbbb", () => {});\n'],
    ['a title carrier for a different known criterion', 'it("[covers:F-aaaaaaaa/AC-cccccccc] covers a sibling", () => {});\n'],
  ])('rejects %s as migration drop proof', (_label, source) => {
    const root = strictReviewWorkspace('done');
    if (source.includes('AC-cccccccc')) addKnownSiblingCriterion(root);
    const historicTest = join(root, 'tests', 'reviewed.test.ts');
    writeFileSync(historicTest, `${readFileSync(historicTest, 'utf8')}${source}`);
    const operation = strictReviewOperation(root, 'drop');
    const before = workspaceManifest(root);

    expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}))
      .toThrow(expect.objectContaining({code: 'MIGRATION_UNRESOLVED'}));
    expect(workspaceManifest(root)).toEqual(before);
    expectNoTransactionResidue(root);
  });

  test('allows a non-done criterion to drop historic tests without a live title carrier', () => {
    const root = strictReviewWorkspace('planned');
    const operation = strictReviewOperation(root, 'drop');
    const before = workspaceManifest(root);

    expect(editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}).changed).toBe(true);
    expect(workspaceManifest(root)).not.toEqual(before);
    expectNoTransactionResidue(root);
  });

  test('allows a done criterion to retain reviewed historic tests without a live title carrier', () => {
    const root = strictReviewWorkspace('done');
    const operation = strictReviewOperation(root, 'retain');

    expect(editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}).changed).toBe(true);
    expectNoTransactionResidue(root);
  });

  test('authorizes a strict reviewed done criterion from its selected final intent', () => {
    const root = strictReviewWorkspace('done');
    const operation = strictReviewOperation(root, 'retain', 'accept');
    expect(editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}).changed).toBe(true);
    const baseline = compileSpecWorkspace(root).migrationBaseline?.legacyL2Baseline;
    expect(baseline).toMatchObject({decision: 'accept', candidateCount: 1});
    expect(baseline?.authorizations).toEqual([expect.objectContaining({
      criterion: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', sourceStatus: 'done', obligations: ['stage_2.1', 'stage_2.2'],
    })]);
  });

  test('stales a reviewed migration preview when a selected historic test file changes without writing', () => {
    const root = strictReviewWorkspace();
    const operation = strictReviewOperation(root, 'retain');
    writeFileSync(join(root, 'tests', 'reviewed.test.ts'), 'it("historic reviewed case", () => {});\n// changed after review\n');
    const beforeApply = workspaceManifest(root);
    expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}))
      .toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
    expect(workspaceManifest(root)).toEqual(beforeApply);
  });

  test('applies oversized local migration decisions without relaxing generic edit transport', () => {
    const root = workspace();
    const resolutions = oversizedMigrationResolutions(root);
    const operation = {kind: 'project.upgrade_schema' as const, resolutions};
    expect(Buffer.byteLength(JSON.stringify([operation]))).toBeGreaterThan(16 * 1024);

    const beforeGenericRequest = workspaceManifest(root);
    expect(() => parseSpecEditOperations([operation])).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: {workspace: '0'.repeat(64)}})).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    expect(workspaceManifest(root)).toEqual(beforeGenericRequest);

    const duplicatePath = join(root, 'duplicate-resolutions.json');
    writeFileSync(duplicatePath, JSON.stringify({...resolutions, confirmed: [...resolutions.confirmed, resolutions.confirmed[0]!]}));
    const beforeDuplicate = workspaceManifest(root);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({to: '0.2', apply: true, resolutions: duplicatePath, cwd: root})).toEqual({ok: false});
    expect(workspaceManifest(root)).toEqual(beforeDuplicate);

    const resolutionPath = join(root, 'oversized-resolutions.json');
    writeFileSync(resolutionPath, JSON.stringify(resolutions));
    expect(runMigrateCommand({to: '0.2', apply: true, resolutions: resolutionPath, cwd: root})).toEqual({ok: true, changed: true});
    expect(readFileSync(join(root, 'spec.yaml'), 'utf8')).toMatch(/^schema: "0\.2"$/m);
  });

  test('replays a clean-room migration when the canonical schema line carries a YAML comment', () => {
    const root = workspace();
    const operation = migrationOperation(root);
    expect(editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}).changed).toBe(true);

    const schemaPath = join(root, 'spec.yaml');
    const migratedBytes = readFileSync(schemaPath, 'utf8');
    expect(migratedBytes).toMatch(/^schema: "0\.2"$/m);
    writeFileSync(schemaPath, migratedBytes.replace(/^schema: "0\.2"$/m, 'schema: "0.2" # comment'));
    const beforeReplay = workspaceManifest(root);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    expect(runMigrateCommand({to: '0.2', apply: true, cwd: root})).toEqual({ok: true, changed: false});
    expect(stdout).toHaveBeenCalledWith('Schema migration is already applied; no files changed.\n');
    expect(workspaceManifest(root)).toEqual(beforeReplay);
  });

  test('softly reports an unpreviewable source without escaping or writing', () => {
    const root = workspace();
    writeFileSync(join(root, 'spec', 'features', 'cli-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: CLI\nstatus: mystery\nmodules: []\nacceptance_criteria: []\n');
    const before = workspaceManifest(root);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({to: '0.2', cwd: root})).toEqual({ok: false});
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('No files were changed.'));
    expect(workspaceManifest(root)).toEqual(before);
  });

  test('keeps a missing resolution file and its absolute path out of the normal migration shell', () => {
    const root = workspace();
    const before = workspaceManifest(root);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({to: '0.2', apply: true, resolutions: join(root, 'missing-decisions.json'), cwd: root})).toEqual({ok: false});
    const rendered = stderr.mock.calls.map((call) => String(call[0])).join('');
    expect(rendered).toContain('Migration could not be applied.');
    expect(rendered).not.toContain(root);
    expect(workspaceManifest(root)).toEqual(before);
  });

  test('keeps corrupt recovery receipts and an unreadable root inside the Soft Shell', () => {
    const corrupt = workspace();
    mkdirSync(join(corrupt, '.cladding'), {recursive: true});
    writeFileSync(join(corrupt, '.cladding', 'spec-transaction.json'), '{not-json');
    const corruptError = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({to: '0.2', cwd: corrupt})).toEqual({ok: false});
    const corruptText = corruptError.mock.calls.map((call) => String(call[0])).join('');
    expect(corruptText).toContain('prior migration needs recovery');
    expect(corruptText).not.toContain(corrupt);
    expect(corruptText).not.toContain('git restore');

    const unreadable = workspace();
    rmSync(join(unreadable, 'spec.yaml'));
    mkdirSync(join(unreadable, 'spec.yaml'));
    const rootError = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({to: '0.2', cwd: unreadable})).toEqual({ok: false});
    const rootText = rootError.mock.calls.map((call) => String(call[0])).join('');
    expect(rootText).toContain('No files were changed.');
    expect(rootText).not.toContain(unreadable);
  });

  test('reports a successful recovery truthfully for text and JSON previews', () => {
    const textRoot = workspace();
    const textBefore = workspaceManifest(textRoot);
    interruptMigration(textRoot);
    const textOut = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({to: '0.2', cwd: textRoot})).toEqual(expect.objectContaining({ok: true}));
    const renderedText = textOut.mock.calls.map((call) => String(call[0])).join('');
    expect(renderedText).toContain('Recovery restored prior bytes; this action made no additional changes.');
    expect(renderedText).not.toContain('No files were changed.');
    expect(workspaceManifest(textRoot)).toEqual(textBefore);

    const jsonRoot = workspace();
    interruptMigration(jsonRoot);
    textOut.mockClear();
    const jsonOut = textOut;
    const result = runMigrateCommand({to: '0.2', json: true, cwd: jsonRoot});
    expect(result.output).toContain('"recovered": true');
    const renderedJson = JSON.parse(jsonOut.mock.calls.map((call) => String(call[0])).join('')) as {recovered?: boolean};
    expect(renderedJson.recovered).toBe(true);
  });

  test('reports recovery before a missing decisions file without hiding the failed action', () => {
    const textRoot = workspace();
    const textBefore = workspaceManifest(textRoot);
    interruptMigration(textRoot);
    const textError = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({
      to: '0.2', apply: true, resolutions: join(textRoot, 'missing-decisions.json'), cwd: textRoot,
    })).toEqual({ok: false});
    const renderedText = textError.mock.calls.map((call) => String(call[0])).join('');
    expect(renderedText).toBe('Migration could not be applied. Recovery restored prior bytes; this action made no additional changes.\n');
    expect(renderedText).not.toContain('..');
    expect(renderedText).not.toContain(textRoot);
    expect(workspaceManifest(textRoot)).toEqual(textBefore);

    const jsonRoot = workspace();
    const jsonBefore = workspaceManifest(jsonRoot);
    interruptMigration(jsonRoot);
    const jsonOutput = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({
      to: '0.2', apply: true, resolutions: join(jsonRoot, 'missing-decisions.json'), json: true, cwd: jsonRoot,
    })).toEqual({ok: false});
    const renderedJson = JSON.parse(jsonOutput.mock.calls.map((call) => String(call[0])).join('')) as {
      readonly code: string;
      readonly details: string;
      readonly message: string;
      readonly recovered: boolean;
    };
    expect(renderedJson).toMatchObject({
      code: 'MIGRATION_APPLY_FAILED',
      message: 'Migration could not be applied. Recovery restored prior bytes; this action made no additional changes.',
      recovered: true,
    });
    expect(renderedJson.details).toContain('ENOENT');
    expect(renderedJson.message).not.toContain('..');
    expect(workspaceManifest(jsonRoot)).toEqual(jsonBefore);
  });

  test('reports recovered apply without decisions as an additional no-change action', () => {
    const root = workspace();
    const before = workspaceManifest(root);
    interruptMigration(root);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(runMigrateCommand({to: '0.2', apply: true, json: true, cwd: root})).toEqual({ok: false});
    const payload = JSON.parse(output.mock.calls.map((call) => String(call[0])).join('')) as {
      readonly message: string;
      readonly recovered: boolean;
    };
    expect(payload).toEqual({
      error: 'migration_unresolved',
      message: 'Migration decisions still need explicit confirmation. Recovery restored prior bytes; this action made no additional changes.',
      writes: 0,
      recovered: true,
    });
    expect(workspaceManifest(root)).toEqual(before);
  });
});
