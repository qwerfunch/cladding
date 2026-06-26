// Cladding · unit tests for stages/toolchain/gate-config.ts
//
// The `.cladding/config.yaml::gate` block + `{modules:TASK}` token expansion.
// Pins: default when absent, scope parse, command-template parse, per-project
// token expansion, static passthrough, and the null-fallback signal when a
// token has no projects.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {expandModuleTokens, readGateConfig} from '../../../src/stages/toolchain/gate-config.js';
import type {GradleProject} from '../../../src/stages/toolchain/module-scope.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-gatecfg-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function writeConfig(body: string): void {
  mkdirSync(join(dir, '.cladding'), {recursive: true});
  writeFileSync(join(dir, '.cladding', 'config.yaml'), body);
}

const A: GradleProject = {path: ':a', dir: join('/tmp', 'a')};
const B: GradleProject = {path: ':b', dir: join('/tmp', 'b')};

describe('readGateConfig', () => {
  test('defaults to {scope: feature} when no config file', () => {
    expect(readGateConfig(dir)).toEqual({scope: 'feature'});
  });

  test('defaults to feature when config has no gate block', () => {
    writeConfig('agent:\n  mode: host\n  name: claude-code\n');
    expect(readGateConfig(dir)).toEqual({scope: 'feature'});
  });

  test('parses scope: repo', () => {
    writeConfig('gate:\n  scope: repo\n');
    expect(readGateConfig(dir).scope).toBe('repo');
  });

  test('an unknown scope value falls back to feature', () => {
    writeConfig('gate:\n  scope: wat\n');
    expect(readGateConfig(dir).scope).toBe('feature');
  });

  test('parses a gate.commands template', () => {
    writeConfig('gate:\n  commands:\n    test: ["./gradlew", "{modules:test}"]\n');
    expect(readGateConfig(dir).commands?.test).toEqual(['./gradlew', '{modules:test}']);
  });

  test('ignores a non-string-array command entry', () => {
    writeConfig('gate:\n  commands:\n    test: "nope"\n');
    expect(readGateConfig(dir).commands).toBeUndefined();
  });
});

describe('expandModuleTokens', () => {
  test('expands {modules:TASK} to one :project:task per project', () => {
    const out = expandModuleTokens(['./gradlew', '{modules:test}'], [A, B]);
    expect(out).toEqual({cmd: './gradlew', args: [':a:test', ':b:test']});
  });

  test('passes static (token-less) elements through verbatim', () => {
    const out = expandModuleTokens(['./gradlew', 'test', '--info'], [A]);
    expect(out).toEqual({cmd: './gradlew', args: ['test', '--info']});
  });

  test('mixes tokens and static args, preserving order', () => {
    const out = expandModuleTokens(['./gradlew', '{modules:koverXmlReport}', '--continue'], [A, B]);
    expect(out).toEqual({
      cmd: './gradlew',
      args: [':a:koverXmlReport', ':b:koverXmlReport', '--continue'],
    });
  });

  test('returns null when a token has no projects (caller falls back to repo gate)', () => {
    expect(expandModuleTokens(['./gradlew', '{modules:test}'], [])).toBeNull();
  });
});
