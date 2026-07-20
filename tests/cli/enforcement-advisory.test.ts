// Cladding · F-f4e184f7 — enforcement advisory for the feature cycle.
//
// enforcementAdvisory(cwd) returns one non-blocking line when a project has
// features not yet done but neither a cladding hook nor CI enforces the checks —
// and undefined when any suppressor holds. It is derived from cwd alone (never a
// gate result), so it can only inform.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {enforcementAdvisory} from '../../src/cli/enforcement-advisory.js';

const spec = (status: string): string =>
  [
    'schema: "0.1"',
    'project: {name: t, language: typescript}',
    'features:',
    '  - id: F-aaa111',
    '    slug: alpha',
    '    title: alpha',
    `    status: ${status}`,
    '    modules: [src/foo.ts]',
    '    acceptance_criteria:',
    '      - id: AC-001',
    '        ears: ubiquitous',
    '        text: t',
    '',
  ].join('\n');

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-enf-adv-'));
});
afterEach(() => rmSync(cwd, {recursive: true, force: true}));

function writeSpec(status: string): void {
  writeFileSync(join(cwd, 'spec.yaml'), spec(status), 'utf8');
}
function installHook(kind: 'pre-commit' | 'pre-push'): void {
  mkdirSync(join(cwd, '.git', 'hooks'), {recursive: true});
  writeFileSync(join(cwd, '.git', 'hooks', kind), `#!/bin/sh\n# cladding ${kind} hook — installed by clad init\nexit 0\n`);
}
function addCiWorkflow(): void {
  mkdirSync(join(cwd, '.github', 'workflows'), {recursive: true});
  writeFileSync(join(cwd, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
}

describe('F-f4e184f7 — enforcement advisory', () => {
  test('AC-4566fd98 — undone features + no hook + no CI → an advisory naming the count', () => {
    writeSpec('in_progress');
    const out = enforcementAdvisory(cwd);
    expect(out).toBeTypeOf('string');
    expect(out).toContain('1 feature');
    expect(out).toContain('nothing enforces the checks');
  });

  test('planned (spec-first) features also count as not-yet-done', () => {
    writeSpec('planned');
    expect(enforcementAdvisory(cwd)).toContain('not yet done');
  });

  describe('AC-2fd01eaa — any one suppressor silences it', () => {
    test('an installed pre-push hook suppresses it', () => {
      writeSpec('in_progress');
      installHook('pre-push');
      expect(enforcementAdvisory(cwd)).toBeUndefined();
    });

    test('an installed pre-commit hook suppresses it', () => {
      writeSpec('in_progress');
      installHook('pre-commit');
      expect(enforcementAdvisory(cwd)).toBeUndefined();
    });

    test('a CI workflow directory suppresses it', () => {
      writeSpec('in_progress');
      addCiWorkflow();
      expect(enforcementAdvisory(cwd)).toBeUndefined();
    });

    test('no undone features → no advisory', () => {
      writeSpec('done');
      expect(enforcementAdvisory(cwd)).toBeUndefined();
    });

    test('a missing/invalid spec → no advisory (not this check to speak)', () => {
      expect(enforcementAdvisory(cwd)).toBeUndefined(); // no spec.yaml written
      writeFileSync(join(cwd, 'spec.yaml'), 'not: a valid spec\n');
      expect(enforcementAdvisory(cwd)).toBeUndefined();
    });
  });

  test('AC-be0cbdaa — a foreign (non-cladding) hook does NOT suppress it', () => {
    writeSpec('in_progress');
    mkdirSync(join(cwd, '.git', 'hooks'), {recursive: true});
    writeFileSync(join(cwd, '.git', 'hooks', 'pre-push'), '#!/bin/sh\n# someone elses hook\nexit 0\n');
    expect(enforcementAdvisory(cwd)).toContain('not yet done');
  });
});
