// Cladding · unit tests for stages/detectors/ai-hints-forbidden-pattern.ts (F-00eb1a)

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {aiHintsForbiddenPattern} from '../../src/stages/detectors/ai-hints-forbidden-pattern.js';

function writeMinimalSpec(dir: string, projectExtras = ''): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    `schema: "0.1"\nproject:\n  name: x\n  language: typescript${projectExtras}\nfeatures: []\n`,
  );
}

function writeSrc(dir: string, relPath: string, content: string): void {
  const abs = join(dir, 'src', relPath);
  mkdirSync(join(abs, '..'), {recursive: true});
  writeFileSync(abs, content);
}

describe('AI_HINTS_FORBIDDEN_PATTERN (F-00eb1a, v0.3.57)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-ai-hints-det-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('no ai_hints → silent', () => {
    writeMinimalSpec(dir);
    writeSrc(dir, 'a.ts', 'export const x = eval("1+1");\n');
    expect(aiHintsForbiddenPattern.run({cwd: dir})).toEqual([]);
  });

  test('empty forbidden_patterns → silent', () => {
    writeMinimalSpec(
      dir,
      '\n  ai_hints:\n    preferred_persona: software-engineer\n    forbidden_patterns: []',
    );
    writeSrc(dir, 'a.ts', 'export const x = eval("1+1");\n');
    expect(aiHintsForbiddenPattern.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-00eb1a/AC-002] remains opt-in when ai_hints is absent or its forbidden list is empty', () => {
    writeMinimalSpec(dir);
    writeSrc(dir, 'absent.ts', 'export const x = eval("1+1");\n');
    expect(aiHintsForbiddenPattern.run({cwd: dir})).toEqual([]);

    writeMinimalSpec(
      dir,
      '\n  ai_hints:\n    preferred_persona: software-engineer\n    forbidden_patterns: []',
    );
    writeSrc(dir, 'empty.ts', 'export const y = eval("1+1");\n');
    expect(aiHintsForbiddenPattern.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-00eb1a/AC-001] forbidden pattern in source → error finding', () => {
    writeMinimalSpec(
      dir,
      '\n  ai_hints:\n    forbidden_patterns: ["eval("]',
    );
    writeSrc(dir, 'a.ts', 'export const x = eval("1+1");\n');
    const findings = aiHintsForbiddenPattern.run({cwd: dir});
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('src/a.ts');
    expect(findings[0].line).toBe(1);
  });

  test('[covers:F-00eb1a/AC-003] forbidden pattern only in comment → silent (false-positive guard)', () => {
    writeMinimalSpec(
      dir,
      '\n  ai_hints:\n    forbidden_patterns: ["eval("]',
    );
    writeSrc(dir, 'a.ts', '// note: never use eval(\nexport const x = 1;\n');
    expect(aiHintsForbiddenPattern.run({cwd: dir})).toEqual([]);
  });

  test('multiple patterns and multiple files', () => {
    writeMinimalSpec(
      dir,
      '\n  ai_hints:\n    forbidden_patterns: ["eval(", "innerHTML"]',
    );
    writeSrc(dir, 'a.ts', 'const x = eval("1");\n');
    writeSrc(dir, 'b/c.tsx', 'el.innerHTML = "<b>x</b>";\n');
    writeSrc(dir, 'clean.ts', 'export const ok = true;\n');
    const findings = aiHintsForbiddenPattern.run({cwd: dir});
    expect(findings.length).toBe(2);
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual(['src/a.ts', 'src/b/c.tsx']);
  });

  test('no src/ directory → silent', () => {
    writeMinimalSpec(
      dir,
      '\n  ai_hints:\n    forbidden_patterns: ["eval("]',
    );
    expect(aiHintsForbiddenPattern.run({cwd: dir})).toEqual([]);
  });

  test('no spec.yaml → silent', () => {
    writeSrc(dir, 'a.ts', 'const x = eval("1");\n');
    expect(aiHintsForbiddenPattern.run({cwd: dir})).toEqual([]);
  });

  test('inline `// cladding-disable AI_HINTS_FORBIDDEN_PATTERN` skips the line', () => {
    writeMinimalSpec(
      dir,
      '\n  ai_hints:\n    forbidden_patterns: ["eval("]',
    );
    writeSrc(
      dir,
      'a.ts',
      [
        '// Example prompt text:',
        'export const PROMPT_LINE = "use eval( cautiously"; // cladding-disable AI_HINTS_FORBIDDEN_PATTERN',
        'export const x = 1;',
      ].join('\n'),
    );
    expect(aiHintsForbiddenPattern.run({cwd: dir})).toEqual([]);
  });

  test('disable comment with colon also works', () => {
    writeMinimalSpec(
      dir,
      '\n  ai_hints:\n    forbidden_patterns: ["eval("]',
    );
    writeSrc(
      dir,
      'a.ts',
      'const fragment = "eval(...)"; // cladding-disable: AI_HINTS_FORBIDDEN_PATTERN',
    );
    expect(aiHintsForbiddenPattern.run({cwd: dir})).toEqual([]);
  });
});
