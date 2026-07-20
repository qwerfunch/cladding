// Cladding · F-4643d99d — check-only formatter lint findings.
//
// A check-only formatter (dart format --set-exit-if-changed, dotnet format
// --verify-no-changes) prints one `Changed <path>` line per dirty file. Those
// don't match the ESLint stylish regex, so the raw-tail fallback used to collapse
// the whole set to a single pathless finding (whack-a-mole). This proves every
// dirty file now surfaces with its path, plus a one-line fix hint.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {parseToolFindings} from '../../src/stages/finding-parser.js';

vi.mock('execa', () => ({execaSync: vi.fn()}));
const {runLint} = await import('../../src/stages/lint.js');
const execaMod = await import('execa');
const execaSyncMock = execaMod.execaSync as unknown as ReturnType<typeof vi.fn>;

describe('F-4643d99d — check-only formatter lint findings', () => {
  test('AC-7b620bf4 — dart `Changed <path>` lines → one finding per file, each with a path', () => {
    const out = [
      'Changed lib/a.dart',
      'Changed lib/nested/b.dart',
      'Changed test/c_test.dart',
      'Formatted 12 files (3 changed) in 0.40 seconds.',
    ].join('\n');
    const findings = parseToolFindings('lint', out, '', 1);
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.path)).toEqual(['lib/a.dart', 'lib/nested/b.dart', 'test/c_test.dart']);
    expect(findings.every((f) => f.detector === 'LINT' && f.severity === 'error')).toBe(true);
  });

  test('AC-83a47b38 — an unstructured formatter failure keeps ONE raw-tail synthetic finding', () => {
    const findings = parseToolFindings('lint', 'panic: could not run formatter\n  at main', '', 1);
    expect(findings).toHaveLength(1);
    expect(findings[0].detector).toBe('LINT');
    expect(findings[0].path).toBeUndefined();
    expect(findings[0].message).toContain('panic');
  });

  test('a green stage (exit 0) yields no findings', () => {
    expect(parseToolFindings('lint', 'Formatted 5 files (0 changed).', '', 0)).toEqual([]);
  });

  describe('AC-6c16b63e — fix hint on a failing check-only formatter (lint stage)', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'clad-lint-mf-'));
      writeFileSync(join(dir, 'pubspec.yaml'), 'name: x\nversion: 0.0.0\n'); // plain dart → `dart format`
      execaSyncMock.mockReset();
    });
    afterEach(() => rmSync(dir, {recursive: true, force: true}));

    test('dart format failure → hint `dart format .` and every dirty file listed', () => {
      execaSyncMock.mockReturnValue({
        exitCode: 1,
        stdout: 'Changed lib/a.dart\nChanged lib/b.dart\nFormatted 5 files (2 changed).',
        stderr: '',
      });
      const r = runLint({cwd: dir});
      expect(r.pass).toBe(false);
      expect(r.hint).toBe('dart format .');
      expect(r.findings?.map((f) => f.path)).toEqual(['lib/a.dart', 'lib/b.dart']);
    });

    test('a green dart run → no hint, no findings', () => {
      execaSyncMock.mockReturnValue({exitCode: 0, stdout: 'Formatted 5 files (0 changed).', stderr: ''});
      const r = runLint({cwd: dir});
      expect(r.pass).toBe(true);
      expect(r.hint).toBeUndefined();
    });
  });
});
