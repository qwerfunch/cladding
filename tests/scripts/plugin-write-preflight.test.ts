// Cladding · F7-B4 · D10 build-plugin operation ownership preflight.

import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {derivePluginMirror} from '../../scripts/plugin-mirror-policy.mjs';
import {resolveManagedWrite} from '../../src/spec/compiler/artifact-registry.js';

const roots: string[] = [];
const helper = join(process.cwd(), 'scripts', 'plugin-write-preflight.ts');

function run(plan: unknown): void {
  execFileSync(process.execPath, ['--import', 'tsx', helper], {input: JSON.stringify(plan), stdio: 'pipe'});
}

describe('plugin build D10 preflight', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
  });

  test('all mirror destinations and every real build region resolve exactly once', () => {
    const census = derivePluginMirror(process.cwd());
    for (const entry of census.expected) {
      expect(resolveManagedWrite({path: entry.path, operation: 'update'}).id).toBe('plugin-persona-skill-mirrors');
    }
    expect(resolveManagedWrite({path: 'plugins/claude-code/dist/clad.js', operation: 'update'}).id).toBe('claude-bundled-engine');
    expect(resolveManagedWrite({path: 'plugins/claude-code/dist/schema.json', operation: 'update'}).id).toBe('claude-bundled-engine');
    expect(resolveManagedWrite({path: 'plugins/claude-code/.claude-plugin/plugin.json', region: 'ironclad.detectors', operation: 'update'}).id).toBe('claude-plugin-detector-region');
    expect(resolveManagedWrite({path: 'plugins/claude-code/.claude-plugin/plugin.json', region: 'stages-implemented', operation: 'update'}).id).toBe('claude-plugin-stages-region');
  });

  test('an injected unowned target aborts before any planned byte can change', () => {
    const root = mkdtempSync(join(tmpdir(), 'plugin-preflight-'));
    roots.push(root);
    const sentinel = join(root, 'sentinel.txt');
    writeFileSync(sentinel, 'before\n');
    expect(() => run([{operation: 'update', path: 'unowned/output.txt'}])).toThrow();
    expect(readFileSync(sentinel, 'utf8')).toBe('before\n');
  });
});
