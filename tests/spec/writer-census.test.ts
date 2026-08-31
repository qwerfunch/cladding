// Cladding · F4 · retired direct specification-writer census.

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, test} from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function toolBody(text: string, name: string, following: string): string {
  const start = text.lastIndexOf(`'${name}'`);
  const end = text.indexOf(`'${following}'`, start + 1);
  if (start < 0 || end < 0) throw new Error(`missing MCP tool boundary ${name}`);
  return text.slice(start, end);
}

function functionBody(text: string, signature: string, following?: string): string {
  const start = text.indexOf(signature);
  const end = following === undefined ? text.length : text.indexOf(following, start + signature.length);
  if (start < 0 || end < 0) throw new Error(`missing function boundary ${signature}`);
  return text.slice(start, end);
}

describe('F4 source-level specification writer census', () => {
  test('schema 0.2 adapters retain no raw feature, status, proof, or derived-projection writer', () => {
    for (const path of ['src/spec/new.ts', 'src/oracle/record.ts']) {
      const text = source(path);
      expect(text).toContain('commitSchema01CompatibilityMutation');
      expect(text).toContain('editSpec');
    }
    expect(source('src/spec/new.ts')).not.toContain('writeFileSync');
    const done = source('src/cli/done.ts');
    expect(done).toContain('markFeatureDoneForGate');
    expect(done).toContain('restoreFailedDoneForGate');
    expect(done).not.toContain('writeFileSync');
    const oracle = source('src/oracle/record.ts');
    const stamp = oracle.slice(oracle.indexOf('export function addOracleRef'), oracle.indexOf('export function recordOracle'));
    expect(stamp).toContain('commitSchema01CompatibilityMutation');
    expect(stamp).not.toContain('writeFileSync');
    for (const path of ['src/serve/server.ts', 'src/cli/update.ts']) {
      expect(source(path)).not.toMatch(/\bwriteInventoryToSpecYaml\s*\(/);
      expect(source(path)).not.toMatch(/\bwriteFeatureIndex\s*\(/);
    }
  });

  test('legacy MCP additive create has one compatibility transaction and no whole-root rollback', () => {
    const create = toolBody(source('src/serve/server.ts'), 'clad_create_feature', 'clad_resolve_design_impact');
    expect(create).toContain('createSchema01FeatureComposite');
    expect(create).not.toContain('capturePathRollback');
    expect(create).not.toContain('restorePathRollback');
    expect(create).not.toContain('syncInventory(cwd)');
  });

  test('derived projections expose pure renderers, not raw managed-writer exports', () => {
    const inventory = source('src/spec/inventory.ts');
    expect(inventory).toContain('export function upsertInventoryBlock');
    expect(inventory).toContain('export function renderFeatureIndexYaml');
    expect(inventory).not.toContain('export function writeInventoryToSpecYaml');
    expect(inventory).not.toContain('export function writeFeatureIndex');
    expect(source('src/spec/doc-references.ts')).not.toContain('export function writeDocLinksYaml');
    for (const path of ['src/serve/server.ts', 'src/cli/update.ts', 'src/cli/done.ts', 'src/spec/new.ts']) {
      const text = source(path);
      expect(text).not.toMatch(/\bwriteInventoryToSpecYaml\s*\(/);
      expect(text).not.toMatch(/\bwriteFeatureIndex\s*\(/);
    }
  });

  test('verification attestation uses the cooperative F4 journal rather than a raw managed write', () => {
    const attestation = source('src/spec/attestation.ts');
    expect(attestation).toContain('commitGeneratedAttestation');
    expect(attestation).not.toMatch(/\bwriteFileSync\s*\(/);
  });

  test('schema 0.2 authoring adapters use the compiler snapshot and the shared root dispatcher', () => {
    const authoring = source('src/spec/new.ts');
    expect(authoring).toContain("from './compiler/authoring-view.js'");
    expect(authoring).toContain('readSchema02AuthoringSnapshot(cwd)');
    expect(authoring).not.toContain('function isSchema02Workspace');

    const server = source('src/serve/server.ts');
    expect(server).toContain("from '../spec/compiler/authoring-view.js'");
    expect(server).toContain('readSchema02AuthoringSnapshot(cwd)');
    expect(server).not.toContain('function readSchema02Scenario');
    expect(server).not.toMatch(/schema[^\n]{0,96}0\\\.2/);

    const cliRootSelector = functionBody(
      source('src/cli/clad.ts'),
      'function rootSelectsSchema01',
      '/**\n * Runs a tier',
    );
    expect(cliRootSelector).toContain('requiredRootSchema(cwd)');
    expect(cliRootSelector).not.toMatch(/schema\s*:\s*\(\?:/);

    const inventoryRenderer = functionBody(
      source('src/spec/inventory.ts'),
      'export function renderFeatureIndexYaml',
    );
    expect(inventoryRenderer).toContain('requiredRootSchema(cwd)');
  });
});
