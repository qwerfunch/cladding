// Cladding · Spec 0.2 F4 · transaction authority contract tests.

import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';
import yaml from 'yaml';

import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {assuranceClosureInputFromWorkspace} from '../../src/assurance/workspace.js';
import {previewSchema02Migration} from '../../src/spec/compiler/migration-preview.js';
import {applyLocalSchemaMigration, editSpec, migrationPreviewDigest, prepareSpecEdit, readSpecEditRevisions, readSpecTransactionRecoveryReceipt, reclaimSpecTransactionLockForTesting, recoverSpecTransaction, refreshDerivedSpecProjections} from '../../src/spec/edit.js';
import {loadSpec} from '../../src/spec/load.js';
import {resolveDesignImpact} from '../../src/spec/new.js';

const temporary: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f4-edit-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'docs', 'design', 'spec-0.2'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: f4\n  language: typescript\n  purpose: Keep edits recoverable.\n  assurance_level: L2\n  scenario_policy: advisory\n');
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities:\n  - id: governance\n    title: Governance\n    outcome: Keep edits safe.\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  writeFileSync(join(root, 'docs', 'design', 'spec-0.2', 'proof-and-editing.md'), '# Proof and editing\n');
  feature(root, 'one-aaaaaaaa.yaml', 'F-aaaaaaaa', 'One');
  feature(root, 'two-bbbbbbbb.yaml', 'F-bbbbbbbb', 'Two');
  return root;
}

function feature(root: string, name: string, id: string, title: string): void {
  writeFileSync(join(root, 'spec', 'features', name), [
    `id: ${id}`, `title: ${title}`, 'status: planned', `purpose: ${title} keeps its contract clear.`, 'modules: []', 'depends_on: []', 'capability_refs: [governance]', 'acceptance_criteria:', '  - id: AC-cccccccc', '    kind: behavior', '    statement: The system shall keep edits recoverable.', '',
  ].join('\n'));
}

function manifest(root: string, path: string = root): readonly {readonly path: string; readonly bytes: string}[] {
  return readdirSync(path, {withFileTypes: true})
    .filter((entry) => entry.name !== '.cladding')
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) return manifest(root, absolute);
      return [{path: absolute.slice(root.length + 1), bytes: readFileSync(absolute).toString('base64')}];
    });
}

function entryManifest(root: string, path: string = root): readonly {readonly path: string; readonly bytes: string}[] {
  return readdirSync(path, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) return [{path: `${absolute.slice(root.length + 1)}/`, bytes: '<directory>'}, ...entryManifest(root, absolute)];
      return [{path: absolute.slice(root.length + 1), bytes: readFileSync(absolute).toString('base64')}];
    });
}

function request(root: string, operations: Parameters<typeof editSpec>[0]['operations']): Parameters<typeof editSpec>[0] {
  return {cwd: root, operations, inputRevisions: readSpecEditRevisions(root, operations)};
}

/** Installs a minimal valid D14 receipt with legacy-unclassified feature/criterion intent. */
function installLegacyIntentBaseline(root: string, sibling: boolean = false): void {
  mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
  const criteria = [{
    address: 'criterion:F-aaaaaaaa/AC-cccccccc', legacyIntent: {text: 'The system shall keep edits recoverable.'}, classification: 'legacy_unclassified', bindings: [],
    exemption: {id: 'criterion-one', subject: 'criterion:F-aaaaaaaa/AC-cccccccc', reason: 'legacy_criterion_intent'},
  }];
  let shard = readFileSync(join(root, 'spec', 'features', 'one-aaaaaaaa.yaml'), 'utf8')
    .replace('purpose: One keeps its contract clear.\n', '')
    .replace('    kind: behavior\n', '');
  if (sibling) {
    shard = shard.replace('    statement: The system shall keep edits recoverable.\n', '    statement: The system shall keep edits recoverable.\n  - id: AC-dddddddd\n    statement: The system shall keep the sibling exempt.\n');
    criteria.push({
      address: 'criterion:F-aaaaaaaa/AC-dddddddd', legacyIntent: {text: 'The system shall keep the sibling exempt.'}, classification: 'legacy_unclassified', bindings: [],
      exemption: {id: 'criterion-two', subject: 'criterion:F-aaaaaaaa/AC-dddddddd', reason: 'legacy_criterion_intent'},
    });
  }
  writeFileSync(join(root, 'spec', 'features', 'one-aaaaaaaa.yaml'), shard);
  const baseline = {
    schema: 1, sourceSchema: '0.1', project: {address: 'project', legacyIntent: 'Keep edits recoverable.'},
    features: [{address: 'feature:F-aaaaaaaa', title: 'One', exemption: {id: 'feature-one', subject: 'feature:F-aaaaaaaa', reason: 'missing_feature_purpose'}}],
    criteria, scenarios: [],
  };
  writeFileSync(join(root, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), `${JSON.stringify(baseline)}\n`);
}

/** Creates one lossless, addressable 0.1 source used by F4 migration acceptance cases. */
function migrationSource(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f4-migration-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: migrate\n  language: typescript\n  intent_summary: Keep migration honest.\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec/features/legacy-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: Legacy\nstatus: planned\nmodules: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    text: The system shall retain legacy intent.\n    test_refs: [tests/legacy.test.ts]\n');
  writeFileSync(join(root, 'spec/capabilities.yaml'), 'schema: "0.1"\nsource: spec.yaml\ncapabilities:\n  - id: governance\n    title: Governance\n    summary: Keep migration honest.\n    features: [F-aaaaaaaa]\n');
  writeFileSync(join(root, 'spec/architecture.yaml'), 'layers:\n  - [core]\nforbidden_imports: []\n');
  writeFileSync(join(root, 'spec/_doc-links.yaml'), '# exact legacy projection\nschema: "0.1"\ndocs: {}\n');
  writeFileSync(join(root, 'spec/attestation.yaml'), 'legacy: verification-is-not-a-02-receipt\n');
  return root;
}

/** Creates a local baseline without relying on a contributor's global Git configuration. */
function initializeGit(root: string): void {
  execFileSync('git', ['init', '--quiet'], {cwd: root});
  execFileSync('git', ['config', 'user.email', 'f4@example.invalid'], {cwd: root});
  execFileSync('git', ['config', 'user.name', 'F4 fixture'], {cwd: root});
  execFileSync('git', ['add', '.'], {cwd: root});
  execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], {cwd: root});
}

function migrationConfirmations(preview: ReturnType<typeof previewSchema02Migration>): readonly {readonly code: string; readonly subject: string; readonly value?: unknown}[] {
  return preview.requiredResolution.map((item) => item.code === 'PROJECT_LEGACY_L2_BASELINE'
    ? {code: item.code, subject: item.subject, value: 'reject'}
    : {code: item.code, subject: item.subject});
}

function migrationOperation(root: string) {
  const preview = previewSchema02Migration(root);
  return {
    kind: 'project.upgrade_schema' as const,
    resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed: migrationConfirmations(preview)},
  };
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('schema migration receipt serialization', () => {
  test('[covers:F-0b8f23c5/AC-0b8f2305] migration emits independent L2 obligation arrays without YAML anchors', () => {
    const root = migrationSource();
    const featurePath = join(root, 'spec', 'features', 'legacy-aaaaaaaa.yaml');
    writeFileSync(featurePath, readFileSync(featurePath, 'utf8').replace('status: planned', 'status: done'));

    const initialPreview = previewSchema02Migration(root);
    const additions = 128 - initialPreview.legacyL2Baseline.candidateCount;
    expect(additions).toBeGreaterThan(0);
    const additionsYaml = Array.from({length: additions}, (_, index) => {
      const id = `AC-b${index.toString(16).padStart(7, '0')}`;
      return `  - id: ${id}\n    text: The system shall retain independent migration baseline authorization ${index}.\n`;
    }).join('');
    writeFileSync(featurePath, `${readFileSync(featurePath, 'utf8')}${additionsYaml}`);

    const preview = previewSchema02Migration(root);
    expect(preview.legacyL2Baseline.candidateCount).toBe(128);
    const confirmed = migrationConfirmations(preview).map((entry) => entry.code === 'PROJECT_LEGACY_L2_BASELINE'
      ? {...entry, value: 'accept'}
      : entry);
    expect(applyLocalSchemaMigration(root, {
      previewDigest: migrationPreviewDigest(preview),
      confirmed,
    })).toMatchObject({changed: true});

    const compilation = compileSpecWorkspace(root);
    expect(compilation.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
    const authorizations = compilation.migrationBaseline?.legacyL2Baseline?.authorizations;
    expect(authorizations).toHaveLength(128);
    for (const authorization of authorizations ?? []) {
      expect(authorization.obligations).toEqual(['stage_2.1', 'stage_2.2']);
    }

    const baseline = readFileSync(join(root, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), 'utf8');
    const anchorOrAliasLines = baseline.split(/\r?\n/).filter((line) => /^(?:\s*[^#\s][^:]*:\s*|\s*-\s*)[&*][A-Za-z0-9_-]+\b/.test(line));
    expect(anchorOrAliasLines).toEqual([]);
  });
});

describe('typed F4 specification transaction', () => {
  test('T01 allows independently prepared different-shard edits to commit against the latest workspace', () => {
    const root = workspace();
    const left = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'One revised'}];
    const right = [{kind: 'feature.set_title' as const, featureId: 'F-bbbbbbbb', title: 'Two revised'}];
    const leftRequest = request(root, left);
    const rightRequest = request(root, right);
    expect(editSpec(leftRequest).changed).toBe(true);
    expect(editSpec(rightRequest).changed).toBe(true);
    expect(readFileSync(join(root, 'spec/features/one-aaaaaaaa.yaml'), 'utf8')).toContain('One revised');
    expect(readFileSync(join(root, 'spec/features/two-bbbbbbbb.yaml'), 'utf8')).toContain('Two revised');
  });

  test('T02 rejects a second stale edit of the same canonical shard without writes', () => {
    const root = workspace();
    const first = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'First'}];
    const second = [{kind: 'feature.set_purpose' as const, featureId: 'F-aaaaaaaa', purpose: 'Second writer must be stale.'}];
    const firstRequest = request(root, first);
    const secondRequest = request(root, second);
    expect(editSpec(firstRequest).changed).toBe(true);
    const before = manifest(root);
    expect(() => editSpec(secondRequest)).toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
    expect(manifest(root)).toEqual(before);
  });

  test('T03 times out as BUSY without writes when a live owner holds the one workspace lock', () => {
    const root = workspace();
    mkdirSync(join(root, '.cladding'), {recursive: true});
    writeFileSync(join(root, '.cladding', 'spec-transaction.lock'), `${JSON.stringify({pid: process.pid, nonce: 'test'})}\n`);
    const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Never written'}];
    const revisions = readSpecEditRevisionsWithoutLock(root, operation);
    const before = manifest(root);
    expect(() => editSpec({cwd: root, operations: operation, inputRevisions: revisions})).toThrow(expect.objectContaining({code: 'BUSY'}));
    expect(manifest(root)).toEqual(before);
    rmSync(join(root, '.cladding'), {recursive: true, force: true});
  }, 7000);

  test('retires aged malformed owner and abandoned reclaimer guard without retaining BUSY', () => {
    const root = workspace();
    const directory = join(root, '.cladding');
    mkdirSync(directory, {recursive: true});
    const lock = join(directory, 'spec-transaction.lock');
    const guard = `${lock}.reclaim`;
    writeFileSync(lock, '{truncated');
    writeFileSync(guard, '{truncated');
    const stale = new Date(Date.now() - 31_000);
    utimesSync(lock, stale, stale);
    utimesSync(guard, stale, stale);
    const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Recovered owner'}];
    expect(editSpec(request(root, operation)).changed).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(guard)).toBe(false);
  });

  test('reclaims a deterministic dead PID and permits its successor transaction', () => {
    const root = workspace();
    const directory = join(root, '.cladding');
    mkdirSync(directory, {recursive: true});
    const lock = join(directory, 'spec-transaction.lock');
    // The maximum signed PID cannot name a running supported Node process, so
    // the fixture avoids probabilistic real-PID reuse.
    writeFileSync(lock, `${JSON.stringify({pid: 2_147_483_647, nonce: 'dead-owner'})}\n`);
    reclaimSpecTransactionLockForTesting(root);
    expect(existsSync(lock)).toBe(false);
    const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Successor transaction'}];
    expect(editSpec(request(root, operation))).toMatchObject({changed: true});
  });

  test('does not let a slow reclaimer unlink a coordinated successor lock', () => {
    const root = workspace();
    const directory = join(root, '.cladding');
    mkdirSync(directory, {recursive: true});
    const lock = join(directory, 'spec-transaction.lock');
    writeFileSync(lock, '{malformed-owner');
    const stale = new Date(Date.now() - 31_000);
    utimesSync(lock, stale, stale);
    reclaimSpecTransactionLockForTesting(root, () => {
      renameSync(lock, `${lock}.first-reclaimer-retired`);
      writeFileSync(lock, `${JSON.stringify({pid: process.pid, nonce: 'successor'})}\n`);
    });
    expect(readFileSync(lock, 'utf8')).toContain('successor');
  });

  test('T04 lets the pure compiler recover byte-exact pre-state after an interrupted replacement', () => {
    const root = workspace();
    const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Interrupted'}];
    const before = manifest(root);
    expect(() => editSpec({...request(root, operation), testFaultAfterReplacements: 1})).toThrow('InjectedTransactionFault');
    expect(existsSync(join(root, '.cladding', 'spec-transaction.json'))).toBe(true);
    compileSpecWorkspace(root);
    expect(manifest(root)).toEqual(before);
    expect(existsSync(join(root, '.cladding', 'spec-transaction.json'))).toBe(false);
  });

  test('recovers byte-exactly after two separate interruptions', () => {
    const root = workspace();
    const before = entryManifest(root);
    for (const title of ['First interruption', 'Second interruption']) {
      const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title}];
      expect(() => editSpec({...request(root, operation), testFaultAfterReplacements: 1})).toThrow('InjectedTransactionFault');
      expect(recoverSpecTransaction(root)).toBe(true);
      expect(entryManifest(root)).toEqual(before);
    }
  });

  test('restores the full pre-state for every interrupted multi-file replacement index', () => {
    // feature.begin changes its shard, generated inventory/index, and event
    // ledger; every ordered replacement position must recover identically.
    for (const replacementIndex of [1, 2, 3, 4]) {
      const root = workspace();
      const before = entryManifest(root);
      const operation = [{kind: 'feature.begin' as const, featureId: 'F-aaaaaaaa'}];
      expect(() => editSpec({...request(root, operation), testFaultAfterReplacements: replacementIndex})).toThrow('InjectedTransactionFault');
      expect(recoverSpecTransaction(root)).toBe(true);
      expect(entryManifest(root)).toEqual(before);
    }
  });

  test('fails closed and retains the journal when a third-party byte change appears after journal publication', () => {
    const root = workspace();
    const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Journaled title'}];
    const path = join(root, 'spec', 'features', 'one-aaaaaaaa.yaml');
    expect(() => editSpec({...request(root, operation), testBeforeReplacement: (relativePath) => {
      if (relativePath === 'spec/features/one-aaaaaaaa.yaml') writeFileSync(path, 'id: F-aaaaaaaa\ntitle: External writer\n');
    }})).toThrow(expect.objectContaining({code: 'RECOVERY_FAILED'}));
    expect(readFileSync(path, 'utf8')).toContain('External writer');
    expect(existsSync(join(root, '.cladding', 'spec-transaction.json'))).toBe(true);
    expect(() => recoverSpecTransaction(root)).toThrow(expect.objectContaining({code: 'RECOVERY_FAILED'}));
  });

  test('recovery receipt guidance rejects a hostile journal symlink before reading it', () => {
    const root = workspace();
    const outside = join(root, 'outside-receipt.json');
    writeFileSync(outside, '{outside sentinel}');
    mkdirSync(join(root, '.cladding'), {recursive: true});
    symlinkSync(outside, join(root, '.cladding', 'spec-transaction.json'));
    expect(() => readSpecTransactionRecoveryReceipt(root)).toThrow(/symbolic-link ancestor/);
    expect(readFileSync(outside, 'utf8')).toBe('{outside sentinel}');
  });

  test('records root ownership separately for project and generated inventory replacements', () => {
    const root = workspace();
    const project = [{kind: 'project.set_description' as const, description: 'Owned project bytes.'}];
    expect(() => editSpec({...request(root, project), testFaultAfterReplacements: 1})).toThrow('InjectedTransactionFault');
    let journal = JSON.parse(readFileSync(join(root, '.cladding', 'spec-transaction.json'), 'utf8')) as {files: Array<{path: string; rootRegions?: string[]}>};
    expect(journal.files.find((file) => file.path === 'spec.yaml')?.rootRegions).toEqual(['project']);
    compileSpecWorkspace(root);
    const begin = [{kind: 'feature.begin' as const, featureId: 'F-aaaaaaaa'}];
    expect(() => editSpec({...request(root, begin), testFaultAfterReplacements: 1})).toThrow('InjectedTransactionFault');
    journal = JSON.parse(readFileSync(join(root, '.cladding', 'spec-transaction.json'), 'utf8')) as {files: Array<{path: string; rootRegions?: string[]}>};
    expect(journal.files.find((file) => file.path === 'spec.yaml')?.rootRegions).toEqual(['inventory']);
    compileSpecWorkspace(root);
  });

  test('refreshes an inline schema 0.1 census through the journal without zeroing authoritative arrays', () => {
    const root = mkdtempSync(join(tmpdir(), 'clad-f4-inline-sync-'));
    temporary.push(root);
    writeFileSync(join(root, 'spec.yaml'), [
      'schema: "0.1"', 'project:', '  name: inline', '  language: typescript', 'features:', '  - id: F-001', '    title: Inline', '    status: planned', '    modules: []', 'scenarios:', '  - id: S-001', '    title: Journey', 'capabilities:', '  - id: inline', '    title: Inline', 'inventory:', '  features: 0', '  scenarios: 0', '  capabilities: 0', '  test_files: 0', '',
    ].join('\n'));
    expect(refreshDerivedSpecProjections(root)).toBe(true);
    const refreshed = readFileSync(join(root, 'spec.yaml'), 'utf8');
    expect(refreshed).toContain('features: 1');
    expect(refreshed).toContain('scenarios: 1');
    expect(refreshed).toContain('capabilities: 1');
  });

  test('compiler and legacy loader snapshots do not leave a lock directory in a read-only workspace', () => {
    const root = workspace();
    expect(existsSync(join(root, '.cladding'))).toBe(false);
    compileSpecWorkspace(root);
    expect(existsSync(join(root, '.cladding'))).toBe(false);
    const legacy = mkdtempSync(join(tmpdir(), 'clad-f4-read-only-'));
    temporary.push(legacy);
    writeFileSync(join(legacy, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: legacy\n  language: typescript\nfeatures: []\nscenarios: []\n');
    loadSpec(legacy);
    expect(existsSync(join(legacy, '.cladding'))).toBe(false);
  });

  test('rolls back a catchable replacement failure before returning an ordinary error', () => {
    const root = workspace();
    const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Never retained'}];
    const before = manifest(root);
    expect(() => editSpec({...request(root, operation), testErrorAfterReplacements: 1})).toThrow('InjectedTransactionIoError');
    expect(manifest(root)).toEqual(before);
    expect(existsSync(join(root, '.cladding', 'spec-transaction.json'))).toBe(false);
  });

  test('retires transaction-created scenario parents on ordinary rollback and interrupted recovery', () => {
    const root = workspace();
    const operation = [{
      kind: 'scenario.upsert' as const,
      scenario: {
        id: 'S-dddddddd', slug: 'recovery-journey', title: 'Recovery journey', actor: 'Operator', goal: 'Recover', success: 'Workspace is restored',
        steps: ['Start the recovery'], featureRefs: ['F-aaaaaaaa'],
      },
    }];
    const before = entryManifest(root);
    expect(() => editSpec({...request(root, operation), testErrorAfterReplacements: 4})).toThrow('InjectedTransactionIoError');
    expect(entryManifest(root)).toEqual(before);
    expect(() => editSpec({...request(root, operation), testFaultAfterReplacements: 4})).toThrow('InjectedTransactionFault');
    compileSpecWorkspace(root);
    expect(entryManifest(root)).toEqual(before);
  });

  test('begins once with one checkpoint, is idempotent while active, and blocks archive metadata changes', () => {
    const root = workspace();
    const begin = [{kind: 'feature.begin' as const, featureId: 'F-aaaaaaaa'}];
    expect(editSpec(request(root, begin)).checkpointedFeatures).toEqual(['F-aaaaaaaa']);
    expect(editSpec(request(root, begin)).changed).toBe(false);
    const events = readFileSync(join(root, '.cladding/events.log.jsonl'), 'utf8').trim().split('\n');
    expect(events).toHaveLength(1);
    const block = [{kind: 'feature.block' as const, featureId: 'F-aaaaaaaa', reason: 'Awaiting review'}];
    expect(editSpec(request(root, block)).changed).toBe(true);
    const archive = [{kind: 'feature.archive' as const, featureId: 'F-aaaaaaaa', reason: 'Superseded', supersededBy: 'F-bbbbbbbb'}];
    expect(editSpec(request(root, archive)).changed).toBe(true);
    const archived = readFileSync(join(root, 'spec/features/one-aaaaaaaa.yaml'), 'utf8');
    expect(archived).toContain('archived_at:');
    expect(editSpec(request(root, archive)).changed).toBe(false);
    expect(readFileSync(join(root, 'spec/features/one-aaaaaaaa.yaml'), 'utf8')).toBe(archived);
    const mismatch = [{kind: 'feature.archive' as const, featureId: 'F-aaaaaaaa', reason: 'Different'}];
    expect(() => editSpec(request(root, mismatch))).toThrow(expect.objectContaining({code: 'LIFECYCLE'}));
  });

  test('adds one pre-batch checkpoint when an active begin brackets a feature-local companion edit', () => {
    const root = workspace();
    const begin = [{kind: 'feature.begin' as const, featureId: 'F-aaaaaaaa'}];
    expect(editSpec(request(root, begin)).changed).toBe(true);
    const batch = [
      {kind: 'feature.begin' as const, featureId: 'F-aaaaaaaa'},
      {kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Companion title'},
    ];
    expect(editSpec(request(root, batch)).checkpointedFeatures).toEqual(['F-aaaaaaaa']);
    expect(readFileSync(join(root, '.cladding/events.log.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  test('creates a feature and its design-impact decision in one journaled batch with an authored event', () => {
    const root = workspace();
    const operations = [
      {kind: 'feature.create' as const, id: 'F-dddddddd', slug: 'new-boundary', title: 'New boundary', purpose: 'Keep the one-write boundary complete.', capabilityRefs: ['governance'], criteria: []},
      {kind: 'feature.set_design_impact' as const, featureId: 'F-dddddddd', designImpact: {classification: 'none' as const, rationale: 'No structural contract changes.'}},
    ];
    expect(editSpec(request(root, operations)).changed).toBe(true);
    const shard = readFileSync(join(root, 'spec', 'features', 'new-boundary-dddddddd.yaml'), 'utf8');
    expect(shard).toContain('classification: none');
    const events = readFileSync(join(root, '.cladding/events.log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as {type: string; payload: {feature?: string; slug?: string; head?: string; identity?: unknown}});
    expect(events.map((event) => event.type)).toEqual(['feature_created']);
    expect(events[0]?.payload).toMatchObject({feature: 'F-dddddddd', slug: 'new-boundary'});
    expect(events[0]?.payload.identity).toEqual(expect.any(Object));
  });

  test('rejects caller-underdeclared revisions and cyclic typed link replacement without writes', () => {
    const root = workspace();
    const underdeclared = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'No revision'}];
    expect(() => editSpec({cwd: root, operations: underdeclared, inputRevisions: {}})).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    expect(() => editSpec({cwd: root, operations: underdeclared, inputRevisions: {feature: 'forged'}})).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    const operations = [
      {kind: 'feature.set_links' as const, featureId: 'F-aaaaaaaa', dependsOn: ['F-bbbbbbbb']},
      {kind: 'feature.set_links' as const, featureId: 'F-bbbbbbbb', dependsOn: ['F-aaaaaaaa']},
    ];
    const before = manifest(root);
    expect(() => editSpec(request(root, operations))).toThrow(expect.objectContaining({code: 'UNKNOWN_REFERENCE'}));
    expect(manifest(root)).toEqual(before);
  });

  test('rejects unknown transport operations and never treats a context revision as write authority', () => {
    const root = workspace();
    const before = manifest(root);
    expect(() => editSpec({cwd: root, operations: [{kind: 'feature.set_path', featureId: 'F-aaaaaaaa'}] as never, inputRevisions: {}})).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    expect(manifest(root)).toEqual(before);
    const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Prepared'}];
    const prepared = prepareSpecEdit(root, operation);
    expect(editSpec(request(root, [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Other'}])).changed).toBe(true);
    expect(() => editSpec({cwd: root, operations: operation, inputRevisions: prepared.inputRevisions, contextRevision: prepared.contextRevision})).toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
  });

  test('rejects an oversized or malformed projection revision before any write', () => {
    const root = workspace();
    const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Never written'}];
    const before = manifest(root);
    expect(() => editSpec({cwd: root, operations: operation, inputRevisions: readSpecEditRevisions(root, operation), contextRevision: 'x'.repeat(17 * 1024)})).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    expect(() => editSpec({cwd: root, operations: operation, inputRevisions: readSpecEditRevisions(root, operation), contextRevision: 'not-a-digest'})).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    expect(manifest(root)).toEqual(before);
  });

  test('U01 unresolved schema migration leaves every source byte unchanged', () => {
    const root = migrationSource();
    const preview = previewSchema02Migration(root);
    const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed: []}};
    const before = manifest(root);
    expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])})).toThrow(expect.objectContaining({code: 'MIGRATION_UNRESOLVED'}));
    expect(manifest(root)).toEqual(before);
  });

  test('requires a separate literal accept-or-reject L2 baseline decision without writing', () => {
    for (const value of ['missing', 'undefined', 'invalid'] as const) {
      const root = migrationSource();
      const preview = previewSchema02Migration(root);
      const confirmed = migrationConfirmations(preview).flatMap((item) => {
        if (item.code !== 'PROJECT_LEGACY_L2_BASELINE') return [item];
        if (value === 'missing') return [];
        return [value === 'undefined'
          ? {code: item.code, subject: item.subject}
          : {code: item.code, subject: item.subject, value: 'approve'}];
      });
      const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed}};
      const before = manifest(root);
      expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}))
        .toThrow(expect.objectContaining({code: 'MIGRATION_UNRESOLVED'}));
      expect(manifest(root)).toEqual(before);
    }
  });

  test('rejects every non-literal historic test-binding disposition without a write', () => {
    for (const testBindingDisposition of ['keep', null, {selection: 'retain'}] as const) {
      const root = migrationSource();
      const featurePath = join(root, 'spec', 'features', 'legacy-aaaaaaaa.yaml');
      writeFileSync(featurePath, readFileSync(featurePath, 'utf8').replace('    text: The system shall retain legacy intent.\n', ''));
      const preview = previewSchema02Migration(root);
      const confirmed = preview.requiredResolution.map((item) => item.code === 'PROJECT_LEGACY_L2_BASELINE'
        ? {code: item.code, subject: item.subject, value: 'reject'}
        : item.code === 'CRITERION_TEXT_UNKNOWN'
        ? {
            code: item.code,
            subject: item.subject,
            value: {
              statement: 'The system shall retain the reviewed historic test input.',
              kind: 'behavior',
              testBindingDisposition,
            },
          }
        : {code: item.code, subject: item.subject});
      const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed}};
      const before = manifest(root);
      expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])})).toThrow(expect.objectContaining({code: 'MIGRATION_UNRESOLVED'}));
      expect(manifest(root)).toEqual(before);
    }
  });

  test('rejects a reviewed migration when the inventory test-file census changes', () => {
    const root = migrationSource();
    mkdirSync(join(root, 'tests'), {recursive: true});
    writeFileSync(join(root, 'tests', 'before.test.ts'), 'export {};\n');
    const preview = previewSchema02Migration(root);
    writeFileSync(join(root, 'tests', 'after.test.ts'), 'export {};\n');
    const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed: []}};
    const before = manifest(root);
    expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])})).toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
    expect(manifest(root)).toEqual(before);
  });

  test('U03 atomically applies an explicitly confirmed clean-room migration and is zero-diff on replay', () => {
    const root = migrationSource();
    const preview = previewSchema02Migration(root);
    const confirmed = migrationConfirmations(preview);
    const beforeForged = manifest(root);
    const forged = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: 'f'.repeat(64), confirmed}};
    expect(() => editSpec({cwd: root, operations: [forged], inputRevisions: readSpecEditRevisions(root, [forged])})).toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
    expect(manifest(root)).toEqual(beforeForged);
    const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed}};
    expect(editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}).changed).toBe(true);
    expect(readFileSync(join(root, 'spec/_doc-links.yaml'), 'utf8')).toBe('# exact legacy projection\nschema: "0.1"\ndocs: {}\n');
    expect(existsSync(join(root, 'spec/attestation.yaml'))).toBe(false);
    const compilation = compileSpecWorkspace(root);
    expect(compilation.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
    expect(compilation.migrationBaseline?.legacyL2Baseline).toMatchObject({decision: 'reject', authorizations: []});
    expect(compilation.edges).toEqual(expect.arrayContaining([expect.objectContaining({relation: 'contributes_to', from: 'feature:F-aaaaaaaa', to: 'capability:governance'})]));
    const after = manifest(root);
    const replay = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: '0'.repeat(64), confirmed: []}};
    expect(editSpec({cwd: root, operations: [replay], inputRevisions: readSpecEditRevisions(root, [replay])}).changed).toBe(false);
    expect(manifest(root)).toEqual(after);
  });

  test('persists the accepted exact-done L2 authorization census from final migrated targets', () => {
    const root = migrationSource();
    const featurePath = join(root, 'spec', 'features', 'legacy-aaaaaaaa.yaml');
    writeFileSync(featurePath, readFileSync(featurePath, 'utf8').replace('status: planned', 'status: done'));
    writeFileSync(join(root, 'spec', 'features', 'in-progress-bbbbbbbb.yaml'), [
      'id: F-bbbbbbbb', 'title: In-progress source', 'status: in_progress', 'modules: []', 'acceptance_criteria:',
      '  - id: AC-cccccccc', '    text: The system shall remain outside the completed baseline census.', '',
    ].join('\n'));
    const preview = previewSchema02Migration(root);
    const confirmed = migrationConfirmations(preview).map((item) => item.code === 'PROJECT_LEGACY_L2_BASELINE'
      ? {...item, value: 'accept'}
      : item);
    const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed}};
    expect(editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}).changed).toBe(true);
    const receipt = yaml.parse(readFileSync(join(root, 'spec/generated/migration-baseline-0.1-to-0.2.yaml'), 'utf8')) as {
      legacyL2Baseline: {decision: string; candidateCount: number; candidateCensusSha256: string; previewSha256: string; resolutionSha256: string; authorizations: readonly {criterion: string; sourceStatus: string; finalIntentSha256: string; candidateSha256: string; resolutionSha256: string; obligations: readonly string[]}[]};
    };
    expect(receipt.legacyL2Baseline).toMatchObject({
      decision: 'accept', candidateCount: 1,
      candidateCensusSha256: preview.legacyL2Baseline.candidateCensusSha256,
      previewSha256: migrationPreviewDigest(preview),
    });
    expect(receipt.legacyL2Baseline.authorizations).toEqual([expect.objectContaining({
      criterion: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', sourceStatus: 'done', obligations: ['stage_2.1', 'stage_2.2'],
      finalIntentSha256: expect.stringMatching(/^[a-f0-9]{64}$/), candidateSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      resolutionSha256: receipt.legacyL2Baseline.resolutionSha256,
    })]);
  });

  test('fails closed for a broken Git context but permits the same clean-room migration outside Git', () => {
    const root = migrationSource();
    const preview = previewSchema02Migration(root);
    const confirmed = migrationConfirmations(preview);
    const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed}};
    const before = manifest(root);
    const savedGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = join(root, 'missing-git-dir');
    try {
      expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])})).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    } finally {
      if (savedGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = savedGitDir;
    }
    expect(manifest(root)).toEqual(before);
  });

  test('migration dirt gate rejects tracked, untracked, and ignored planned paths while allowing unrelated dirt', () => {
    const tracked = migrationSource();
    initializeGit(tracked);
    writeFileSync(join(tracked, 'spec', 'features', 'legacy-aaaaaaaa.yaml'), `${readFileSync(join(tracked, 'spec', 'features', 'legacy-aaaaaaaa.yaml'), 'utf8')}# tracked edit\n`);
    const trackedOperation = migrationOperation(tracked);
    expect(() => editSpec({cwd: tracked, operations: [trackedOperation], inputRevisions: readSpecEditRevisions(tracked, [trackedOperation])})).toThrow(expect.objectContaining({code: 'DIRTY_PLANNED_PATH'}));

    const untracked = migrationSource();
    initializeGit(untracked);
    writeFileSync(join(untracked, 'spec', 'index.yaml'), '# untracked planned projection\n');
    const untrackedOperation = migrationOperation(untracked);
    expect(() => editSpec({cwd: untracked, operations: [untrackedOperation], inputRevisions: readSpecEditRevisions(untracked, [untrackedOperation])})).toThrow(expect.objectContaining({code: 'DIRTY_PLANNED_PATH'}));

    const ignored = migrationSource();
    writeFileSync(join(ignored, '.gitignore'), 'spec/index.yaml\n');
    initializeGit(ignored);
    writeFileSync(join(ignored, 'spec', 'index.yaml'), '# ignored planned projection\n');
    const ignoredOperation = migrationOperation(ignored);
    expect(() => editSpec({cwd: ignored, operations: [ignoredOperation], inputRevisions: readSpecEditRevisions(ignored, [ignoredOperation])})).toThrow(expect.objectContaining({code: 'DIRTY_PLANNED_PATH'}));

    const unrelated = migrationSource();
    writeFileSync(join(unrelated, '.gitignore'), 'private-note.txt\n');
    initializeGit(unrelated);
    writeFileSync(join(unrelated, 'untracked-note.txt'), 'unrelated\n');
    writeFileSync(join(unrelated, 'private-note.txt'), 'ignored unrelated\n');
    execFileSync('git', ['config', 'status.showUntrackedFiles', 'no'], {cwd: unrelated});
    const unrelatedOperation = migrationOperation(unrelated);
    expect(editSpec({cwd: unrelated, operations: [unrelatedOperation], inputRevisions: readSpecEditRevisions(unrelated, [unrelatedOperation])}).changed).toBe(true);
  });

  test('U04 interrupted schema migration restores source bytes before a later recovery can proceed', () => {
    const root = migrationSource();
    const preview = previewSchema02Migration(root);
    const confirmed = migrationConfirmations(preview);
    const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed}};
    const before = manifest(root);
    expect(() => editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation]), testFaultAfterReplacements: 1})).toThrow('InjectedTransactionFault');
    expect(existsSync(join(root, '.cladding', 'spec-transaction.json'))).toBe(true);
    expect(recoverSpecTransaction(root)).toBe(true);
    expect(manifest(root)).toEqual(before);
    expect(existsSync(join(root, '.cladding', 'spec-transaction.json'))).toBe(false);
  });

  test('materializes a non-mixed inline 0.1 source into deterministic legacy-compatible shards', () => {
    const root = mkdtempSync(join(tmpdir(), 'clad-f4-inline-migration-'));
    temporary.push(root);
    writeFileSync(join(root, 'spec.yaml'), [
      'schema: "0.1"', 'project:', '  name: inline', '  language: typescript', '  intent_summary: Preserve inline source.',
      'features:', '  - id: F-001', '    title: Inline feature', '    status: planned', '    modules: []', '    acceptance_criteria:', '      - id: AC-001', '        text: The system shall preserve inline source.',
      'scenarios: []', 'capabilities:', '  - id: governance', '    title: Governance', '    summary: Preserve source.',
      'architecture:', '  layers:', '    - [core]', '  forbidden_imports: []', '',
    ].join('\n'));
    const preview = previewSchema02Migration(root);
    expect(preview.features[0]?.targetPath).toBe('spec/features/F-001.yaml');
    const confirmed = migrationConfirmations(preview);
    const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed}};
    expect(editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}).changed).toBe(true);
    expect(existsSync(join(root, 'spec', 'features', 'F-001.yaml'))).toBe(true);
    expect(readFileSync(join(root, 'spec.yaml'), 'utf8')).not.toContain('\nfeatures:');
    expect(compileSpecWorkspace(root).diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
  });

  test('rejects mixed inline and sharded migration sources before creating a journal', () => {
    const root = workspace();
    const rootBytes = readFileSync(join(root, 'spec.yaml'), 'utf8').replace('schema: "0.2"', 'schema: "0.1"').replace(/\nproject:/, '\nfeatures:\n  - id: F-001\n    title: Inline\n    status: planned\n    modules: []\n    acceptance_criteria: []\nproject:');
    writeFileSync(join(root, 'spec.yaml'), rootBytes);
    expect(() => previewSchema02Migration(root)).toThrow('mixed inline and sharded feature sources');
    expect(existsSync(join(root, '.cladding', 'spec-transaction.json'))).toBe(false);
  });

  test('B01 title and purpose edits revoke their own legacy exemptions', () => {
    const root = workspace();
    installLegacyIntentBaseline(root);
    expect(compileSpecWorkspace(root).diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
    const edit = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Changed'}];
    expect(() => editSpec(request(root, edit))).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    const purpose = [{kind: 'feature.set_purpose' as const, featureId: 'F-aaaaaaaa', purpose: 'The edited feature has an explicit intent.'}];
    expect(editSpec(request(root, purpose)).changed).toBe(true);
  });

  test('B02 criterion add and removal change only the addressed legacy intent node', () => {
    const root = workspace();
    installLegacyIntentBaseline(root);
    const add = [{kind: 'criterion.upsert' as const, featureId: 'F-aaaaaaaa', criterion: {id: 'AC-dddddddd', kind: 'behavior' as const, statement: 'The system shall add an explicit criterion.'}}];
    expect(editSpec(request(root, add)).changed).toBe(true);
    const remove = [{kind: 'criterion.remove' as const, featureId: 'F-aaaaaaaa', criterionId: 'AC-dddddddd'}];
    expect(editSpec(request(root, remove)).changed).toBe(true);
  });

  test('B03 criterion statement and kind edits require a strict replacement', () => {
    const root = workspace();
    installLegacyIntentBaseline(root);
    const operation = [{kind: 'criterion.upsert' as const, featureId: 'F-aaaaaaaa', criterion: {id: 'AC-cccccccc', kind: 'quality' as const, statement: 'The system shall retain a strict edited criterion.'}}];
    expect(editSpec(request(root, operation)).changed).toBe(true);
    expect(compileSpecWorkspace(root).diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
  });

  test('B04 criterion rationale and constraint references revoke only that criterion exemption', () => {
    const root = workspace();
    installLegacyIntentBaseline(root);
    writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules:\n  - id: AR-aaaaaaaa\n    kind: forbidden_import\n    from: core\n    to: adapter\n    rationale: Preserve the boundary.\n');
    const operation = [{kind: 'criterion.upsert' as const, featureId: 'F-aaaaaaaa', criterion: {id: 'AC-cccccccc', kind: 'constraint' as const, statement: 'The system shall enforce the edited constraint.', rationale: 'The boundary needs an explicit rule.', constraintRefs: ['AR-aaaaaaaa']}}];
    expect(editSpec(request(root, operation)).changed).toBe(true);
    expect(compileSpecWorkspace(root).diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
  });

  test('B05 proof and note edits leave a matching legacy intent exemption effective', () => {
    const root = workspace();
    installLegacyIntentBaseline(root);
    const operation = [{kind: 'criterion.set_proof_refs' as const, featureId: 'F-aaaaaaaa', criterionId: 'AC-cccccccc', oracleRefs: ['tests/legacy-oracle.test.ts']}];
    expect(editSpec(request(root, operation)).changed).toBe(true);
    expect(compileSpecWorkspace(root).diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
  });

  test('B06 a strict sibling edit does not revoke the other matching baseline exemption', () => {
    const root = workspace();
    installLegacyIntentBaseline(root, true);
    const operation = [{kind: 'criterion.upsert' as const, featureId: 'F-aaaaaaaa', criterion: {id: 'AC-cccccccc', kind: 'behavior' as const, statement: 'The system shall make one criterion strict.'}}];
    expect(editSpec(request(root, operation)).changed).toBe(true);
    expect(compileSpecWorkspace(root).diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
  });

  test('rejects malformed baseline receipts before they can waive strict validation', () => {
    const root = workspace();
    installLegacyIntentBaseline(root);
    writeFileSync(join(root, 'spec/generated/migration-baseline-0.1-to-0.2.yaml'), '{}\n');
    expect(compileSpecWorkspace(root).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({message: expect.stringContaining('Invalid migration baseline')})]));
  });

  test('hashes and replaces only the project-owned root region while feature and inventory operations preserve root bytes', () => {
    const root = workspace();
    const original = '# root comment\nschema: "0.2"\n# project comment\nproject:\n  name: f4\n  language: typescript\n  purpose: Keep edits recoverable.\n  assurance_level: L2\n  scenario_policy: advisory\n# inventory comment\ninventory:\n  features: 2\n  scenarios: 0\n  capabilities: 1\n  test_files: 7\n';
    writeFileSync(join(root, 'spec.yaml'), original);
    const featureEdit = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Only the shard changes'}];
    expect(editSpec(request(root, featureEdit)).changed).toBe(true);
    expect(readFileSync(join(root, 'spec.yaml'), 'utf8')).toBe(original);
    const projectEdit = [{kind: 'project.set_description' as const, description: 'A project region edit.'}];
    const prepared = request(root, projectEdit);
    writeFileSync(join(root, 'spec.yaml'), original.replace('# project comment', '# edited project comment'));
    expect(() => editSpec(prepared)).toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
    const current = readFileSync(join(root, 'spec.yaml'), 'utf8');
    expect(editSpec(request(root, projectEdit)).changed).toBe(true);
    const after = readFileSync(join(root, 'spec.yaml'), 'utf8');
    expect(after).toContain('# inventory comment\ninventory:');
    expect(after.slice(after.indexOf('# inventory comment'))).toBe(current.slice(current.indexOf('# inventory comment')));
  });

  test('does not let an inventory append stale a project region when project is the final root member', () => {
    const root = workspace();
    const rootBytes = 'schema: "0.2"\nproject:\n  name: f4\n  language: typescript\n  purpose: Keep edits recoverable.\n  assurance_level: L2\n  scenario_policy: advisory\n\n# root-tail\n';
    writeFileSync(join(root, 'spec.yaml'), rootBytes);
    const projectEdit = [{kind: 'project.set_description' as const, description: 'Still current after generated inventory.'}];
    const prepared = request(root, projectEdit);
    expect(editSpec(request(root, [{kind: 'feature.begin' as const, featureId: 'F-aaaaaaaa'}])).changed).toBe(true);
    expect(editSpec(prepared).changed).toBe(true);
    const after = readFileSync(join(root, 'spec.yaml'), 'utf8');
    expect(after).toContain('# root-tail\n\n# Auto-maintained by `clad sync`');
  });

  test('rejects symlink ancestors and hostile journal paths before outside bytes can change', () => {
    const root = workspace();
    const outside = mkdtempSync(join(tmpdir(), 'clad-f4-outside-'));
    temporary.push(outside);
    const sentinel = join(outside, 'sentinel.yaml');
    writeFileSync(sentinel, 'unchanged\n');
    rmSync(join(root, 'spec', 'features'), {recursive: true, force: true});
    try { symlinkSync(outside, join(root, 'spec', 'features'), 'dir'); } catch { return; }
    const operation = [{kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Never outside'}];
    expect(() => readSpecEditRevisions(root, operation)).toThrow();
    expect(readFileSync(sentinel, 'utf8')).toBe('unchanged\n');
    rmSync(join(root, 'spec', 'features'), {force: true});
    mkdirSync(join(root, '.cladding'), {recursive: true});
    writeFileSync(join(root, '.cladding', 'spec-transaction.json'), JSON.stringify({
      format: 1, id: 'a'.repeat(32), phase: 'prepared', paths: ['.git/config'], preflight: {head: null, paths: ['.git/config']},
      files: [{path: '.git/config', before: Buffer.from('changed\n').toString('base64'), after: Buffer.from('other\n').toString('base64')}],
    }));
    expect(() => compileSpecWorkspace(root)).toThrow(expect.objectContaining({code: 'RECOVERY_FAILED'}));
    expect(readFileSync(sentinel, 'utf8')).toBe('unchanged\n');
  });

  test('refuses a zero-file recovery journal without deleting it', () => {
    const root = workspace();
    mkdirSync(join(root, '.cladding'), {recursive: true});
    const path = join(root, '.cladding', 'spec-transaction.json');
    writeFileSync(path, JSON.stringify({format: 1, id: 'a'.repeat(32), phase: 'prepared', paths: [], preflight: {head: null, paths: []}, files: []}));
    expect(() => compileSpecWorkspace(root)).toThrow(expect.objectContaining({code: 'RECOVERY_FAILED'}));
    expect(existsSync(path)).toBe(true);
  });

  test('revokes exactly one content-addressed receipt through the explicit delete authority', () => {
    const root = workspace();
    const digest = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    mkdirSync(join(root, 'spec', 'evidence', 'F-aaaaaaaa'), {recursive: true});
    writeFileSync(join(root, 'spec', 'evidence', 'F-aaaaaaaa', `${digest}.yaml`), 'feature_id: F-aaaaaaaa\n');
    writeFileSync(join(root, 'spec', 'evidence', 'F-aaaaaaaa', `${other}.yaml`), 'feature_id: F-aaaaaaaa\n');
    const operation = [{kind: 'evidence.revoke' as const, featureId: 'F-aaaaaaaa', digest}];
    expect(editSpec(request(root, operation)).changed).toBe(true);
    expect(existsSync(join(root, 'spec', 'evidence', 'F-aaaaaaaa', `${digest}.yaml`))).toBe(false);
    expect(readFileSync(join(root, 'spec', 'evidence', 'F-aaaaaaaa', `${other}.yaml`), 'utf8')).toContain('F-aaaaaaaa');
  });

  test('refreshes capability inventory and feature-index module counts in the same transaction', () => {
    const root = workspace();
    const capability = [{kind: 'capability.upsert' as const, capability: {id: 'audit', title: 'Audit', outcome: 'Retain audit facts.'}}];
    expect(editSpec(request(root, capability)).changed).toBe(true);
    expect(readFileSync(join(root, 'spec.yaml'), 'utf8')).toContain('capabilities: 2');
    const modules = [{kind: 'feature.set_links' as const, featureId: 'F-aaaaaaaa', modules: ['src/a.ts', 'src/b.ts']}];
    expect(editSpec(request(root, modules)).changed).toBe(true);
    expect(readFileSync(join(root, 'spec/index.yaml'), 'utf8')).toContain('F-aaaaaaaa: {slug: one, status: planned, modules: 2}');
  });

  test('derives structural design baselines under the lock and rejects forged resolution payloads', () => {
    const root = workspace();
    const artifact = 'docs/design/spec-0.2/proof-and-editing.md';
    const alternateArtifact = 'docs/design/spec-0.2/graph.md';
    writeFileSync(join(root, alternateArtifact), '# Graph\n');
    const create = [{kind: 'feature.set_design_impact' as const, featureId: 'F-aaaaaaaa', designImpact: {classification: 'structural', rationale: 'Architecture needs review.', artifacts: [artifact]}}];
    expect(editSpec(request(root, create)).changed).toBe(true);
    const shard = readFileSync(join(root, 'spec/features/one-aaaaaaaa.yaml'), 'utf8');
    expect(shard).toContain('status: review_required');
    expect(shard).toContain('baseline_digests');
    const forged = [{kind: 'feature.set_design_impact' as const, featureId: 'F-aaaaaaaa', designImpact: {classification: 'structural', rationale: 'Architecture needs review.', artifacts: [alternateArtifact], status: 'resolved'}}];
    const before = manifest(root);
    expect(() => editSpec(request(root, forged))).toThrow(/recorded artifact set/);
    expect(manifest(root)).toEqual(before);
    const unregistered = [{kind: 'feature.set_design_impact' as const, featureId: 'F-bbbbbbbb', designImpact: {classification: 'structural', rationale: 'Architecture needs review.', artifacts: ['src/spec/edit.ts']}}];
    expect(() => editSpec(request(root, unregistered))).toThrow(/registered design document/);
    expect(manifest(root)).toEqual(before);
    const unchanged = [{kind: 'feature.set_design_impact' as const, featureId: 'F-aaaaaaaa', designImpact: {classification: 'structural', rationale: 'Architecture needs review.', artifacts: [artifact], status: 'resolved'}}];
    expect(() => editSpec(request(root, unchanged))).toThrow(/unchanged artifact/);
    writeFileSync(join(root, artifact), '# Proof and editing revised\n');
    const resolve = [{kind: 'feature.set_design_impact' as const, featureId: 'F-aaaaaaaa', designImpact: {classification: 'structural', rationale: 'Architecture needs review.', artifacts: [artifact], status: 'resolved'}}];
    expect(editSpec(request(root, resolve)).changed).toBe(true);
    expect(readFileSync(join(root, 'spec/features/one-aaaaaaaa.yaml'), 'utf8')).toContain('status: resolved');
  });

  test('resolves an exact migrated structural review without a new digest baseline', () => {
    const root = migrationSource();
    const artifact = 'docs/design/spec-0.2/proof-and-editing.md';
    mkdirSync(join(root, 'docs', 'design', 'spec-0.2'), {recursive: true});
    writeFileSync(join(root, artifact), '# Reviewed migration design\n');
    const featurePath = join(root, 'spec', 'features', 'legacy-aaaaaaaa.yaml');
    writeFileSync(featurePath, `${readFileSync(featurePath, 'utf8')}design_impact:\n  classification: structural\n  rationale: Preserve the reviewed migration boundary.\n  status: review_required\n  artifacts: ["${artifact}"]\n`);
    const upgrade = migrationOperation(root);
    expect(editSpec({cwd: root, operations: [upgrade], inputRevisions: readSpecEditRevisions(root, [upgrade])}).changed).toBe(true);
    const baseline = yaml.parse(readFileSync(join(root, 'spec/generated/migration-baseline-0.1-to-0.2.yaml'), 'utf8')) as {features: readonly {address: string; legacyStructuralReview?: unknown}[]};
    expect(baseline.features.find((feature) => feature.address === 'feature:F-aaaaaaaa')?.legacyStructuralReview).toEqual({
      classification: 'structural', rationale: 'Preserve the reviewed migration boundary.', status: 'review_required', artifacts: [artifact],
    });
    expect(resolveDesignImpact({cwd: root, feature: 'F-aaaaaaaa'})).toMatchObject({changed: true});
    expect(readFileSync(featurePath, 'utf8')).toContain('status: resolved');
  });

  test('rejects re-baselining an exact migrated structural review without a write', () => {
    const root = migrationSource();
    const artifact = 'docs/design/spec-0.2/proof-and-editing.md';
    mkdirSync(join(root, 'docs', 'design', 'spec-0.2'), {recursive: true});
    writeFileSync(join(root, artifact), '# Reviewed migration design\n');
    const featurePath = join(root, 'spec', 'features', 'legacy-aaaaaaaa.yaml');
    writeFileSync(featurePath, `${readFileSync(featurePath, 'utf8')}design_impact:\n  classification: structural\n  rationale: Preserve the reviewed migration boundary.\n  status: review_required\n  artifacts: ["${artifact}"]\n`);
    const upgrade = migrationOperation(root);
    expect(editSpec({cwd: root, operations: [upgrade], inputRevisions: readSpecEditRevisions(root, [upgrade])}).changed).toBe(true);
    const rebaseline = [{kind: 'feature.set_design_impact' as const, featureId: 'F-aaaaaaaa', designImpact: {classification: 'structural' as const, rationale: 'Preserve the reviewed migration boundary.', artifacts: [artifact], status: 'review_required' as const}}];
    const before = manifest(root);
    expect(() => editSpec(request(root, rebaseline))).toThrow(/may only transition to resolved/);
    expect(manifest(root)).toEqual(before);
  });

  test('rejects missing immutable migrated review records without a write', () => {
    const root = migrationSource();
    const artifact = 'docs/design/spec-0.2/proof-and-editing.md';
    mkdirSync(join(root, 'docs', 'design', 'spec-0.2'), {recursive: true});
    writeFileSync(join(root, artifact), '# Reviewed migration design\n');
    const featurePath = join(root, 'spec', 'features', 'legacy-aaaaaaaa.yaml');
    writeFileSync(featurePath, `${readFileSync(featurePath, 'utf8')}design_impact:\n  classification: structural\n  rationale: Preserve the reviewed migration boundary.\n  status: review_required\n  artifacts: ["${artifact}"]\n`);
    const upgrade = migrationOperation(root);
    expect(editSpec({cwd: root, operations: [upgrade], inputRevisions: readSpecEditRevisions(root, [upgrade])}).changed).toBe(true);
    const baselinePath = join(root, 'spec/generated/migration-baseline-0.1-to-0.2.yaml');
    const baseline = yaml.parse(readFileSync(baselinePath, 'utf8')) as {features: {address: string; legacyStructuralReview?: unknown}[]};
    for (const feature of baseline.features) {
      if (feature.address === 'feature:F-aaaaaaaa') delete feature.legacyStructuralReview;
    }
    writeFileSync(baselinePath, yaml.stringify(baseline));
    const resolution = [{kind: 'feature.set_design_impact' as const, featureId: 'F-aaaaaaaa', designImpact: {classification: 'structural' as const, rationale: 'Preserve the reviewed migration boundary.', artifacts: [artifact], status: 'resolved' as const}}];
    const before = manifest(root);
    expect(() => editSpec(request(root, resolution))).toThrow(/immutable migration baseline review/);
    expect(manifest(root)).toEqual(before);
  });

  test('rejects a mismatched migrated review record without a write', () => {
    const root = migrationSource();
    const artifact = 'docs/design/spec-0.2/proof-and-editing.md';
    mkdirSync(join(root, 'docs', 'design', 'spec-0.2'), {recursive: true});
    writeFileSync(join(root, artifact), '# Reviewed migration design\n');
    const featurePath = join(root, 'spec', 'features', 'legacy-aaaaaaaa.yaml');
    writeFileSync(featurePath, `${readFileSync(featurePath, 'utf8')}design_impact:\n  classification: structural\n  rationale: Preserve the reviewed migration boundary.\n  status: review_required\n  artifacts: ["${artifact}"]\n`);
    const upgrade = migrationOperation(root);
    expect(editSpec({cwd: root, operations: [upgrade], inputRevisions: readSpecEditRevisions(root, [upgrade])}).changed).toBe(true);
    writeFileSync(featurePath, readFileSync(featurePath, 'utf8').replace('Preserve the reviewed migration boundary.', 'Forged review rationale.'));
    const before = manifest(root);
    expect(() => resolveDesignImpact({cwd: root, feature: 'F-aaaaaaaa'})).toThrow(/immutable migration baseline review/);
    expect(manifest(root)).toEqual(before);
  });

  test('writes a pre-batch checkpoint before a resolved design-impact event', () => {
    const root = workspace();
    const artifact = 'docs/design/spec-0.2/proof-and-editing.md';
    const pending = [{kind: 'feature.set_design_impact' as const, featureId: 'F-aaaaaaaa', designImpact: {classification: 'structural', rationale: 'Review the architecture.', artifacts: [artifact]}}];
    expect(editSpec(request(root, pending)).changed).toBe(true);
    writeFileSync(join(root, artifact), '# Completed review\n');
    const batch = [
      {kind: 'feature.begin' as const, featureId: 'F-aaaaaaaa'},
      {kind: 'feature.set_design_impact' as const, featureId: 'F-aaaaaaaa', designImpact: {classification: 'structural', rationale: 'Review complete.', artifacts: [artifact], status: 'resolved' as const}},
    ];
    expect(editSpec(request(root, batch)).changed).toBe(true);
    const events = readFileSync(join(root, '.cladding/events.log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as {type: string});
    expect(events.map((event) => event.type)).toEqual(['feature_checkpoint', 'design_impact_resolved']);
  });

  test('keeps readable legacy ids mutable while requiring generated ids for new shards', () => {
    const root = workspace();
    feature(root, 'F-001.yaml', 'F-001', 'Legacy sequential');
    const legacy = [{kind: 'feature.begin' as const, featureId: 'F-001'}];
    expect(editSpec(request(root, legacy)).changed).toBe(true);
    expect(readFileSync(join(root, 'spec/index.yaml'), 'utf8')).toContain('F-001: {slug: F-001, status: in_progress');
    const before = manifest(root);
    const malformed = [{kind: 'feature.create' as const, id: 'F-002', slug: 'new-legacy', title: 'Never created', purpose: 'Generated ids are required.', capabilityRefs: [], criteria: []}];
    expect(() => editSpec({cwd: root, operations: malformed, inputRevisions: readSpecEditRevisions(root, malformed)})).toThrow(expect.objectContaining({code: 'INVALID_OPERATION'}));
    expect(manifest(root)).toEqual(before);
  });

  test('migrates direct hash feature and scenario filenames then edits their preserved shards', () => {
    const root = migrationSource();
    const sluggedFeature = join(root, 'spec', 'features', 'legacy-aaaaaaaa.yaml');
    writeFileSync(join(root, 'spec', 'features', 'F-aaaaaaaa.yaml'), readFileSync(sluggedFeature, 'utf8'));
    rmSync(sluggedFeature);
    mkdirSync(join(root, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(join(root, 'spec', 'scenarios', 'S-aaaaaaaa.yaml'), [
      'id: S-aaaaaaaa', 'title: Direct scenario', 'flow: Legacy journey', '',
    ].join('\n'));
    writeFileSync(join(root, 'spec.yaml'), readFileSync(join(root, 'spec.yaml'), 'utf8').replace('scenarios: []\n', ''));
    const preview = previewSchema02Migration(root);
    expect(preview.features[0]?.targetPath).toBe('spec/features/F-aaaaaaaa.yaml');
    expect(preview.scenarios[0]?.targetPath).toBe('spec/scenarios/S-aaaaaaaa.yaml');
    const confirmed = preview.requiredResolution.map((item) => item.code === 'PROJECT_LEGACY_L2_BASELINE'
      ? {code: item.code, subject: item.subject, value: 'reject'}
      : item.code === 'SCENARIO_MEANING_REQUIRED'
      ? {code: item.code, subject: item.subject, value: {actor: 'Operator', goal: 'Finish', success: 'Finished', steps: ['Start'], feature_refs: ['F-aaaaaaaa']}}
      : {code: item.code, subject: item.subject});
    const operation = {kind: 'project.upgrade_schema' as const, resolutions: {previewDigest: migrationPreviewDigest(preview), confirmed}};
    expect(editSpec({cwd: root, operations: [operation], inputRevisions: readSpecEditRevisions(root, [operation])}).changed).toBe(true);
    const compilation = compileSpecWorkspace(root);
    expect(compilation.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
    const contract = compilation.contract as unknown as {
      readonly features: readonly {
        readonly id: string;
        readonly purpose?: string;
        readonly baselineIdentity?: string;
        readonly acceptanceCriteria: readonly {readonly id: string; readonly kind?: string; readonly statement: string; readonly baselineIdentity?: string}[];
      }[];
      readonly scenarios: readonly {
        readonly id: string;
        readonly title: string;
        readonly actor: string;
        readonly goal: string;
        readonly success: string;
        readonly steps: readonly string[];
        readonly featureRefs: readonly string[];
      }[];
    } | undefined;
    expect(contract).toBeDefined();
    const featureBaseline = compilation.migrationBaseline?.features.find((entry) => entry.address === 'feature:F-aaaaaaaa');
    const criterionBaseline = compilation.migrationBaseline?.criteria.find((entry) => entry.address === 'criterion:F-aaaaaaaa/AC-bbbbbbbb');
    expect(contract?.scenarios).toEqual([{
      id: 'S-aaaaaaaa', title: 'Direct scenario', actor: 'Operator', goal: 'Finish', success: 'Finished', steps: ['Start'], featureRefs: ['F-aaaaaaaa'],
    }]);
    const migratedFeature = contract?.features.find((feature) => feature.id === 'F-aaaaaaaa');
    expect(migratedFeature).toMatchObject({id: 'F-aaaaaaaa', baselineIdentity: featureBaseline?.exemption?.id});
    expect(migratedFeature).not.toHaveProperty('purpose');
    const migratedCriterion = migratedFeature?.acceptanceCriteria.find((criterion) => criterion.id === 'AC-bbbbbbbb');
    expect(migratedCriterion).toMatchObject({
      id: 'AC-bbbbbbbb', statement: 'The system shall retain legacy intent.',
      kind: 'legacy_unclassified', baselineIdentity: criterionBaseline?.exemption.id,
    });
    expect(featureBaseline).toMatchObject({
      exemption: {subject: 'feature:F-aaaaaaaa', reason: 'missing_feature_purpose'},
    });
    expect(criterionBaseline).toMatchObject({
      classification: 'legacy_unclassified',
      exemption: {subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', reason: 'legacy_criterion_intent'},
    });
    const closureInput = assuranceClosureInputFromWorkspace(root, compilation);
    expect(closureInput.features).toEqual([expect.objectContaining({
      id: 'F-aaaaaaaa', baselineIdentity: featureBaseline?.exemption?.id,
      criteria: [expect.objectContaining({
        id: 'AC-bbbbbbbb', legacyUnclassified: true, baselineIdentity: criterionBaseline?.exemption.id,
      })],
    })]);
    const featureEdit = [
      {kind: 'feature.set_title' as const, featureId: 'F-aaaaaaaa', title: 'Direct filename remains editable'},
      {kind: 'feature.set_purpose' as const, featureId: 'F-aaaaaaaa', purpose: 'The migrated feature now has an explicit purpose.'},
    ];
    const scenarioEdit = [{kind: 'scenario.upsert' as const, scenario: {id: 'S-aaaaaaaa', slug: 'direct-scenario', title: 'Direct scenario remains editable', actor: 'Operator', goal: 'Finish', success: 'Finished', steps: ['Start'], featureRefs: ['F-aaaaaaaa']}}];
    expect(editSpec(request(root, featureEdit)).changed).toBe(true);
    expect(editSpec(request(root, scenarioEdit)).changed).toBe(true);
    expect(existsSync(join(root, 'spec', 'scenarios', 'S-aaaaaaaa.yaml'))).toBe(true);
  });
});

function readSpecEditRevisionsWithoutLock(
  root: string,
  operations: Parameters<typeof editSpec>[0]['operations'],
): Readonly<Record<string, string>> {
  const lock = join(root, '.cladding', 'spec-transaction.lock');
  rmSync(lock, {force: true});
  const revisions = readSpecEditRevisions(root, operations);
  writeFileSync(lock, `${JSON.stringify({pid: process.pid, nonce: 'test'})}\n`);
  return revisions;
}
