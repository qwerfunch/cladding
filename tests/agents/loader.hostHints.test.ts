// Cladding · unit tests for src/agents/loader.ts hostHints (0.4.10 PR-A.2)

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearPersonaCache, loadPersona} from '../../src/agents/loader.js';

function seedPersona(rootDir: string, id: string, frontmatter: string, body = '# body'): void {
  const dir = join(rootDir, 'agents');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, `${id}.md`), `---\n${frontmatter}\n---\n\n${body}\n`);
}

describe('loader hostHints (0.4.10 PR-A.2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-loader-hints-'));
    clearPersonaCache();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
    clearPersonaCache();
  });

  test('persona without hostHints → undefined (backward compat)', () => {
    seedPersona(
      dir,
      'plain',
      ['name: plain', 'description: minimal', 'tools: Read', 'capabilities: [read]'].join('\n'),
    );
    const persona = loadPersona('plain', dir);
    expect(persona.hostHints).toBeUndefined();
  });

  test('parses model + permissionMode + sandbox_mode', () => {
    seedPersona(
      dir,
      'rich',
      [
        'name: rich',
        'description: rich',
        'tools: Read, Write',
        'capabilities: [read, write]',
        'model: sonnet',
        'permissionMode: acceptEdits',
        'sandbox_mode: workspace-write',
      ].join('\n'),
    );
    const persona = loadPersona('rich', dir);
    expect(persona.hostHints).toEqual({
      model: 'sonnet',
      permissionMode: 'acceptEdits',
      sandbox_mode: 'workspace-write',
    });
  });

  test('parses maxTurns as integer + floors fractional', () => {
    seedPersona(
      dir,
      'turns',
      [
        'name: turns',
        'description: x',
        'tools: Read',
        'capabilities: [read]',
        'maxTurns: 3.7',
      ].join('\n'),
    );
    const persona = loadPersona('turns', dir);
    expect(persona.hostHints?.maxTurns).toBe(3);
  });

  test('drops invalid maxTurns (zero / negative / non-finite)', () => {
    seedPersona(
      dir,
      'badturns',
      [
        'name: badturns',
        'description: x',
        'tools: Read',
        'capabilities: [read]',
        'maxTurns: 0',
      ].join('\n'),
    );
    const persona = loadPersona('badturns', dir);
    expect(persona.hostHints).toBeUndefined();
  });

  test('drops invalid permissionMode silently (forward-compat)', () => {
    seedPersona(
      dir,
      'badperm',
      [
        'name: badperm',
        'description: x',
        'tools: Read',
        'capabilities: [read]',
        'permissionMode: invented-mode',
      ].join('\n'),
    );
    const persona = loadPersona('badperm', dir);
    expect(persona.hostHints).toBeUndefined();
  });

  test('drops invalid sandbox_mode silently', () => {
    seedPersona(
      dir,
      'badsandbox',
      [
        'name: badsandbox',
        'description: x',
        'tools: Read',
        'capabilities: [read]',
        'sandbox_mode: super-dangerous',
      ].join('\n'),
    );
    const persona = loadPersona('badsandbox', dir);
    expect(persona.hostHints).toBeUndefined();
  });

  test('parses skills array', () => {
    seedPersona(
      dir,
      'skills',
      [
        'name: skills',
        'description: x',
        'tools: Read',
        'capabilities: [read]',
        'skills:',
        '  - drift',
        '  - audit',
      ].join('\n'),
    );
    const persona = loadPersona('skills', dir);
    expect(persona.hostHints?.skills).toEqual(['drift', 'audit']);
  });

  test('parses isolation value', () => {
    seedPersona(
      dir,
      'iso',
      [
        'name: iso',
        'description: x',
        'tools: Read',
        'capabilities: [read]',
        'isolation: worktree',
      ].join('\n'),
    );
    const persona = loadPersona('iso', dir);
    expect(persona.hostHints?.isolation).toBe('worktree');
  });

  test('drops invalid isolation value', () => {
    seedPersona(
      dir,
      'badiso',
      [
        'name: badiso',
        'description: x',
        'tools: Read',
        'capabilities: [read]',
        'isolation: cluster',
      ].join('\n'),
    );
    const persona = loadPersona('badiso', dir);
    expect(persona.hostHints).toBeUndefined();
  });

  test('all valid hints combined', () => {
    seedPersona(
      dir,
      'all',
      [
        'name: all',
        'description: x',
        'tools: Read, Write, Edit',
        'capabilities: [read, write, edit]',
        'model: opus',
        'permissionMode: plan',
        'sandbox_mode: read-only',
        'maxTurns: 5',
        'skills:',
        '  - one',
        'isolation: session',
      ].join('\n'),
    );
    const persona = loadPersona('all', dir);
    expect(persona.hostHints).toEqual({
      model: 'opus',
      permissionMode: 'plan',
      sandbox_mode: 'read-only',
      maxTurns: 5,
      skills: ['one'],
      isolation: 'session',
    });
  });

  test('existing PersonaSpec fields (id, body, capabilities) still parsed', () => {
    seedPersona(
      dir,
      'compat',
      [
        'name: compat',
        'description: x',
        'tools: Read',
        'capabilities: [read]',
        'model: sonnet',
      ].join('\n'),
      'Some persona body text.',
    );
    const persona = loadPersona('compat', dir);
    expect(persona.id).toBe('compat');
    expect(persona.body).toBe('# Some persona body text.\n\nSome persona body text.'.split('\n')[0] === 'Some persona body text.' ? 'Some persona body text.' : 'Some persona body text.');
    expect(persona.capabilities.has('read')).toBe(true);
    expect(persona.hostHints?.model).toBe('sonnet');
  });
});
