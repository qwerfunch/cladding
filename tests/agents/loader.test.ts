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
//   - 0.6.0 alias resolution: librarian → planner, specialists → developer
//     (old id loads the new persona + one-line stderr deprecation notice)

import {readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {clearPersonaCache, loadPersona} from '../../src/agents/loader.js';

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

  test('[covers:F-063/AC-159] parses frontmatter + body into PersonaSpec', () => {
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
      join(agentsDir, 'planner.md'),
      '---\ncapabilities:\n  - read\n---\nbody\n',
    );
    const p = loadPersona('planner', root);
    expect(p.id).toBe('planner');
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

  // 0.6.0 renames (docs/glossary.md): the old persona ids stay loadable for
  // one minor release; resolving one loads the NEW file and prints a one-line
  // stderr deprecation notice naming the replacement.
  test("resolves deprecated id 'librarian' to the planner persona with a deprecation notice", () => {
    writeFileSync(
      join(agentsDir, 'planner.md'),
      '---\nname: planner\ncapabilities: [read, write]\n---\nplanner body\n',
    );
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const p = loadPersona('librarian', root);
      expect(p.id).toBe('planner');
      expect(p.body).toBe('planner body');
      const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain(
        "cladding: persona 'librarian' is now 'planner' — the old id is removed in 0.8",
      );
    } finally {
      stderrSpy.mockRestore();
    }
  });

  test("resolves deprecated id 'specialists' to the developer persona with a deprecation notice", () => {
    writeFileSync(
      join(agentsDir, 'developer.md'),
      '---\nname: developer\ncapabilities: [read, write, edit, exec]\n---\ndeveloper body\n',
    );
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const p = loadPersona('specialists', root);
      expect(p.id).toBe('developer');
      expect(p.body).toBe('developer body');
      const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain(
        "cladding: persona 'specialists' is now 'developer' — the old id is removed in 0.8",
      );
    } finally {
      stderrSpy.mockRestore();
    }
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

// ─── F-d8223c — the blind-author definition is structurally blinded ───

describe('blind-author (F-d8223c)', () => {
  test('[covers:F-d8223c/AC-862413] the canonical definition grants NO read-capable tool and no read capability', () => {
    const raw = readFileSync(join(process.cwd(), 'src', 'agents', 'blind-author.md'), 'utf8');
    const toolsLine = /^tools:\s*(.+)$/m.exec(raw)![1];
    expect(toolsLine).toContain('Write');
    for (const forbidden of ['Read', 'Grep', 'Glob', 'Edit']) {
      expect(toolsLine.includes(forbidden), `${forbidden} must not be granted`).toBe(false);
    }
    const p = loadPersona('blind-author');
    expect(p.capabilities.has('write')).toBe(true);
    expect(p.capabilities.has('read')).toBe(false);
  });
});
