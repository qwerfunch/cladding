// Cladding · unit tests for stages/detectors/slug-conflict.ts (F-084)

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {slugConflict} from '../../src/stages/detectors/slug-conflict.js';

function writeMaster(dir: string): void {
  writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: x\n  language: typescript\n');
}

function writeFeature(
  dir: string,
  fileName: string,
  body: {id: string; slug?: string; title?: string; status?: string},
): void {
  mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  const lines = [
    `id: ${body.id}`,
    body.slug ? `slug: ${body.slug}` : null,
    `title: ${JSON.stringify(body.title ?? body.id)}`,
    `status: ${body.status ?? 'planned'}`,
    'modules: []',
    'acceptance_criteria: []',
  ].filter((l): l is string => l !== null);
  writeFileSync(join(dir, 'spec', 'features', fileName), lines.join('\n') + '\n');
}

describe('SLUG_CONFLICT detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-slug-conflict-'));
    writeMaster(dir);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('no slugs → no findings', () => {
    writeFeature(dir, 'F-001.yaml', {id: 'F-001'});
    expect(slugConflict.run({cwd: dir})).toEqual([]);
  });

  test('distinct slugs → no findings', () => {
    writeFeature(dir, 'login-flow.yaml', {id: 'F-a3f9c2', slug: 'login-flow'});
    writeFeature(dir, 'mfa-otp.yaml', {id: 'F-b7e102', slug: 'mfa-otp'});
    expect(slugConflict.run({cwd: dir})).toEqual([]);
  });

  test('two features sharing a slug → error finding', () => {
    writeFeature(dir, 'F-a3f9c2.yaml', {id: 'F-a3f9c2', slug: 'login-flow'});
    writeFeature(dir, 'F-b7e102.yaml', {id: 'F-b7e102', slug: 'login-flow'});
    const findings = slugConflict.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('login-flow');
    expect(findings[0].message).toContain('F-a3f9c2');
    expect(findings[0].message).toContain('F-b7e102');
  });

  test('spec absent → no findings (soft validator)', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'clad-slug-empty-'));
    try {
      expect(slugConflict.run({cwd: emptyDir})).toEqual([]);
    } finally {
      rmSync(emptyDir, {recursive: true, force: true});
    }
  });
});
