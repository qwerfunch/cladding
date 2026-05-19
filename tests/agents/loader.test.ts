// Cladding · unit tests for agents/loader.ts
//
// loadPersona parses `agents/<id>.md` files into PersonaSpec objects.
// Branches covered:
//   - happy path: real frontmatter + body → parsed spec
//   - frontmatter absent: whole file becomes body
//   - frontmatter unterminated: file treated as plain body
//   - capabilities normalization: only the 5 known values pass through
//   - file missing: throws an Error with a useful message
//   - rootDir option: looks up a custom path instead of the bundled one
//   - cache reuse + clearPersonaCache

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearPersonaCache, loadPersona} from '../../agents/loader.js';

describe('loadPersona', () => {
  let root: string;
  let agentsDir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'clad-loader-'));
    agentsDir = join(root, 'agents');
    mkdirSync(agentsDir, {recursive: true});
    clearPersonaCache();
  });
  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
    clearPersonaCache();
  });

  test('parses frontmatter + body into PersonaSpec', () => {
    writeFileSync(
      join(agentsDir, 'reviewer.md'),
      '---\nname: reviewer-v1\ndescription: reviews code\ncapabilities:\n  - read\n  - exec\n---\nBody prose here.\n',
    );
    const p = loadPersona('reviewer', root);
    expect(p.id).toBe('reviewer-v1');
    expect(p.body).toBe('Body prose here.');
    expect(p.capabilities.has('read')).toBe(true);
    expect(p.capabilities.has('exec')).toBe(true);
    expect(p.capabilities.has('write')).toBe(false);
  });

  test('falls back to file id when frontmatter omits name', () => {
    writeFileSync(
      join(agentsDir, 'librarian.md'),
      '---\ncapabilities:\n  - read\n---\nbody\n',
    );
    const p = loadPersona('librarian', root);
    expect(p.id).toBe('librarian');
  });

  test('missing frontmatter → whole file is body, no capabilities', () => {
    writeFileSync(join(agentsDir, 'plain.md'), 'pure prose, no frontmatter\n');
    const p = loadPersona('plain', root);
    expect(p.id).toBe('plain');
    expect(p.body).toContain('pure prose');
    expect(p.capabilities.size).toBe(0);
  });

  test('unterminated frontmatter is treated as plain body', () => {
    writeFileSync(
      join(agentsDir, 'broken.md'),
      '---\nname: oops\n(but no closing delimiter)\n',
    );
    const p = loadPersona('broken', root);
    expect(p.id).toBe('broken');
    expect(p.capabilities.size).toBe(0);
  });

  test('unknown capability values are dropped (only 5-enum passes)', () => {
    writeFileSync(
      join(agentsDir, 'caps.md'),
      '---\nname: caps\ncapabilities:\n  - read\n  - rogue\n  - write\n---\nbody\n',
    );
    const p = loadPersona('caps', root);
    expect(p.capabilities.has('read')).toBe(true);
    expect(p.capabilities.has('write')).toBe(true);
    expect(p.capabilities.has('rogue' as never)).toBe(false);
    expect(p.capabilities.size).toBe(2);
  });

  test('missing file throws with a clear message', () => {
    expect(() => loadPersona('never-existed', root)).toThrow(/agents\/never-existed\.md not found/);
  });

  test('second call hits the cache (same reference)', () => {
    writeFileSync(
      join(agentsDir, 'cached.md'),
      '---\nname: cached\ncapabilities: [read]\n---\nbody\n',
    );
    const a = loadPersona('cached', root);
    const b = loadPersona('cached', root);
    expect(a).toBe(b); // cache returns the same reference
  });

  test('clearPersonaCache forces a re-parse', () => {
    writeFileSync(
      join(agentsDir, 'mut.md'),
      '---\nname: v1\ncapabilities: [read]\n---\nbody v1\n',
    );
    const first = loadPersona('mut', root);
    writeFileSync(
      join(agentsDir, 'mut.md'),
      '---\nname: v2\ncapabilities: [read, write]\n---\nbody v2\n',
    );
    expect(loadPersona('mut', root)).toBe(first); // still cached
    clearPersonaCache();
    const reparsed = loadPersona('mut', root);
    expect(reparsed).not.toBe(first);
    expect(reparsed.id).toBe('v2');
  });
});
