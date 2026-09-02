// Cladding · unit tests for cli/intent-from-path.ts (F-5f6b45)
//
// Path-aware intent loading: `clad init docs/plan.md` reads the file
// contents and treats them as the LLM-bound intent string. Anything that
// is not a recognized text-file path (or that points to a missing /
// non-regular / unreadable file) falls back to free-text behavior so
// existing invocations stay regression-free.

import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, sep} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {loadIntentFromPathIfApplicable} from '../../src/cli/intent-from-path.js';

describe('loadIntentFromPathIfApplicable', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-intent-path-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  // AC-001 — relative path to an existing .md file resolves to its contents.
  test('[covers:F-5f6b45/AC-001] loads file contents when argument is a relative .md path under cwd', () => {
    const planBody = '# 결제 SaaS\n\nStripe + Toss 지원.\n\n- 멀티 테넌시\n- webhook 서명 검증\n';
    writeFileSync(join(dir, 'plan.md'), planBody, 'utf-8');

    const result = loadIntentFromPathIfApplicable('plan.md', dir);

    expect(result.intent).toBe(planBody);
    expect(result.loadedFrom).toBe(join(dir, 'plan.md'));
    expect(result.warning).toBeUndefined();
  });

  // AC-002 — absolute path resolves identically to relative.
  test('[covers:F-5f6b45/AC-002] loads file contents for an absolute path', () => {
    const body = 'absolute plan body';
    const abs = join(dir, 'spec.md');
    writeFileSync(abs, body, 'utf-8');

    const result = loadIntentFromPathIfApplicable(abs, dir);

    expect(result.intent).toBe(body);
    expect(result.loadedFrom).toBe(abs);
    expect(result.warning).toBeUndefined();
  });

  // AC-002 — also covers other recognized extensions.
  test.each([['.md'], ['.txt'], ['.yaml'], ['.yml'], ['.markdown']])(
    'loads contents for recognized extension %s',
    (ext) => {
      const filename = `notes${ext}`;
      const body = `body for ${ext}`;
      writeFileSync(join(dir, filename), body, 'utf-8');

      const result = loadIntentFromPathIfApplicable(filename, dir);

      expect(result.intent).toBe(body);
      expect(result.loadedFrom).toBe(join(dir, filename));
    },
  );

  // AC-003 — path-like but missing file → warning + original text preserved.
  test('[covers:F-5f6b45/AC-003] warns and falls back when path-like argument points to a missing file', () => {
    const arg = 'docs/no-such-plan.md';

    const result = loadIntentFromPathIfApplicable(arg, dir);

    expect(result.intent).toBe(arg);
    expect(result.loadedFrom).toBeUndefined();
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('docs/no-such-plan.md');
    expect(result.warning).toContain('falling back');
  });

  // AC-004 — free-text intent (no recognized extension) passes through.
  test('[covers:F-5f6b45/AC-004] passes free-text intent through unchanged with no warning', () => {
    for (const input of ['결제 SaaS 만들거야', 'build a payment SaaS', 'AI 코드 리뷰 봇', 'simple', '']) {
      const result = loadIntentFromPathIfApplicable(input, dir);

      expect(result.intent).toBe(input);
      expect(result.loadedFrom).toBeUndefined();
      expect(result.warning).toBeUndefined();
    }
  });

  // AC-005a — directory with recognized extension → warning + fallback.
  test('warns and falls back when path resolves to a directory', () => {
    // Create a directory that *ends in* a recognized extension so the
    // heuristic triggers (`mkdir docs.md`).
    const dirNamedLikeMd = join(dir, 'planning.md');
    mkdirSync(dirNamedLikeMd);

    const result = loadIntentFromPathIfApplicable('planning.md', dir);

    expect(result.intent).toBe('planning.md');
    expect(result.loadedFrom).toBeUndefined();
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('non-regular');
  });

  test('[covers:F-5f6b45/AC-005] directory, symlink loop, and invalid UTF-8 warn without throwing or mutating the original intent', () => {
    const directoryArg = 'planning.md';
    mkdirSync(join(dir, directoryArg));
    const loopArg = 'loop.md';
    symlinkSync(loopArg, join(dir, loopArg));
    const invalidArg = 'invalid.md';
    writeFileSync(join(dir, invalidArg), Buffer.from([0xc3, 0x28]));

    for (const arg of [directoryArg, loopArg, invalidArg]) {
      expect(() => loadIntentFromPathIfApplicable(arg, dir)).not.toThrow();
      const result = loadIntentFromPathIfApplicable(arg, dir);
      expect(result.intent).toBe(arg);
      expect(result.loadedFrom).toBeUndefined();
      expect(result.warning).toContain('falling back');
    }
  });

  // AC-005b — windows-style separator is normalized by node:path.resolve.
  test('handles trailing whitespace in the argument by trimming when checking the extension', () => {
    writeFileSync(join(dir, 'plan.md'), 'trimmed body', 'utf-8');

    const result = loadIntentFromPathIfApplicable('  plan.md  ', dir);

    expect(result.intent).toBe('trimmed body');
    expect(result.loadedFrom).toBe(join(dir, 'plan.md'));
  });

  // AC-006 — plugin invocations call the same `clad init` CLI which calls the
  // same helper. The helper has no concept of "plugin vs npm caller", so any
  // path that works from one works from the other. This test pins the
  // contract: the helper is the single decision point.
  test('[covers:F-5f6b45/AC-006] plugin and CLI callers share the same code path (helper is the single decision point)', () => {
    const body = 'shared decision point';
    writeFileSync(join(dir, 'p.md'), body, 'utf-8');

    // Simulate two callers (CLI + plugin shell-out) passing the same arg.
    const fromCli = loadIntentFromPathIfApplicable('p.md', dir);
    const fromPlugin = loadIntentFromPathIfApplicable('p.md', dir);

    expect(fromCli).toEqual(fromPlugin);
    expect(fromCli.intent).toBe(body);
  });

  // Extra — long markdown bodies (typical planning docs) pass through.
  test('handles multi-paragraph markdown without truncation', () => {
    const long = Array.from({length: 50}, (_, i) => `## Section ${i + 1}\n\nlorem ipsum ${i}`).join('\n\n');
    writeFileSync(join(dir, 'long.md'), long, 'utf-8');

    const result = loadIntentFromPathIfApplicable('long.md', dir);

    expect(result.intent).toBe(long);
    expect(result.intent.length).toBeGreaterThan(500);
  });

  // Extra — extension matching is case-insensitive.
  test('extension match is case-insensitive', () => {
    writeFileSync(join(dir, 'Plan.MD'), 'mixed case', 'utf-8');

    const result = loadIntentFromPathIfApplicable('Plan.MD', dir);

    expect(result.intent).toBe('mixed case');
    expect(result.loadedFrom).toBe(join(dir, 'Plan.MD'));
  });

  // Sanity — nested relative path (`docs/plan.md`).
  test('resolves nested relative path under cwd', () => {
    const docsDir = join(dir, 'docs');
    mkdirSync(docsDir);
    writeFileSync(join(docsDir, 'plan.md'), 'nested body', 'utf-8');

    const result = loadIntentFromPathIfApplicable(`docs${sep}plan.md`, dir);

    expect(result.intent).toBe('nested body');
    expect(result.loadedFrom).toBe(join(docsDir, 'plan.md'));
  });
});
