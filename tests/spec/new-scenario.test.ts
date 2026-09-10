// Cladding · unit tests for createScenario in src/spec/new.ts (F-087)
//
// Mirror of tests/spec/new.test.ts but for the scenario surface.
// createScenario writes spec/scenarios/<slug>-<hash8>.yaml with
// `id: S-<hash8>` and the same multi-dev safety property.

import {mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {parse as parseYaml} from 'yaml';

import {createFeature, createScenario} from '../../src/spec/new.js';

describe('createScenario (F-087, v0.3.12)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-new-scenario-'));
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: scenarios\n  language: typescript\n');
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-d7312b/AC-001] writes spec/scenarios/<slug>-<hash8>.yaml with hash id', () => {
    const r = createScenario({slug: 'checkout-happy-path', cwd: dir});
    expect(r.slug).toBe('checkout-happy-path');
    expect(r.id).toMatch(/^S-[a-f0-9]{8}$/);
    const hash = r.id.slice(2);
    expect(r.path).toBe(
      join(dir, 'spec', 'scenarios', `checkout-happy-path-${hash}.yaml`),
    );
    expect(existsSync(r.path)).toBe(true);
  });

  test('generated yaml has the expected scenario shape', () => {
    const r = createScenario({
      slug: 'login-flow',
      title: 'User login flow',
      features: ['F-001', 'F-a3f9c2'],
      cwd: dir,
    });
    const parsed = parseYaml(readFileSync(r.path, 'utf8'));
    expect(parsed.id).toBe(r.id);
    expect(parsed.slug).toBe('login-flow');
    expect(parsed.title).toBe('User login flow');
    expect(parsed.features).toEqual(['F-001', 'F-a3f9c2']);
  });

  test('title defaults to slug, features default to empty array', () => {
    const r = createScenario({slug: 'minimal-scenario', cwd: dir});
    const parsed = parseYaml(readFileSync(r.path, 'utf8'));
    expect(parsed.title).toBe('minimal-scenario');
    expect(parsed.features).toEqual([]);
  });

  test('two consecutive calls with the same slug produce distinct files', () => {
    const r1 = createScenario({slug: 'same-slug', cwd: dir});
    const r2 = createScenario({slug: 'same-slug', cwd: dir});
    expect(r1.id).not.toBe(r2.id);
    expect(r1.path).not.toBe(r2.path);
    expect(existsSync(r1.path)).toBe(true);
    expect(existsSync(r2.path)).toBe(true);
  });

  test('rejects malformed slug', () => {
    expect(() => createScenario({slug: 'UPPERCASE', cwd: dir})).toThrow(/invalid/);
    expect(() => createScenario({slug: 'has spaces', cwd: dir})).toThrow(/invalid/);
  });

  test('scenario and feature with the same slug live in separate files', () => {
    // Both can coexist because they're in different directories.
    // (This test confirms the namespace isolation; SLUG_CONFLICT
    // detector treats feature and scenario slugs as separate.)
    const f = createFeature({slug: 'shared-name', cwd: dir});
    const s = createScenario({slug: 'shared-name', cwd: dir});
    expect(f.id.startsWith('F-')).toBe(true);
    expect(s.id.startsWith('S-')).toBe(true);
    expect(f.path).toContain('spec/features/');
    expect(s.path).toContain('spec/scenarios/');
  });
});
