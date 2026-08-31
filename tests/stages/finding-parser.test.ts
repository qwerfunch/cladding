// Conformance oracle for feature F-b7873005 (gate-error finding-parser).
//
// Authored impl-blind: assertions derive ONLY from the acceptance criteria and
// the declared interface contract for src/stages/finding-parser.ts. The source
// body was never read. A failure here is a FINDING against the spec, not a bug
// in the test.
//
// AC1  parse tsc / eslint / vitest machine output into findings carrying
//      path, line, rule(detector), message.
// AC2  non-zero exit with nothing parseable => exactly ONE synthetic finding
//      from the raw tail (never "no structure == no problem").
// AC3  a parsed finding carries a path so verdict.next_action can point at
//      file:line (this file proves the finding has a path; the reducer that
//      consumes it lives in F-2e28cc72).
// AC4  soundness: findings come only from the tool's own output; total-safe on
//      adversarial input (never a second compiler pass, never a throw).
// AC5  no side effect: unrecognized output OR a green stage falls back to raw
//      behavior with no error and no change to the gate outcome.
//
// NOTE: the adversarial NUL / replacement-char bytes are built at runtime via
// String.fromCharCode(...) so the SOURCE file is pure ASCII and carries no raw
// NUL byte (house rule: tests/self-consistency.test.ts). The bytes fed to the
// parsers are unchanged: a NUL (0x00) followed by the replacement char U+FFFD.

import {describe, it, expect} from 'vitest';
import type {DriftFinding, StageResult} from '../../src/stages/types.js';
import {
  parseTscFindings,
  parseEslintFindings,
  parseVitestFindings,
  parseToolFindings,
  withFindings,
} from '../../src/stages/finding-parser.js';

const SEVERITIES: ReadonlyArray<DriftFinding['severity']> = ['error', 'warn', 'info'];

// Adversarial bytes assembled from pure-ASCII source (no literal NUL on disk).
const NUL = String.fromCharCode(0x00);
const REPLACEMENT = String.fromCharCode(0xfffd);
// The vitest default-reporter frame marker, built from ASCII source.
const ARROW = String.fromCharCode(0x276f);

describe('finding-parser (F-b7873005)', () => {
  // AC1 — TypeScript machine output.
  it('AC1-tsc: parses tsc diagnostics into path/line/rule/message/severity', () => {
    const findings = parseTscFindings(
      'src/foo.ts(12,7): error TS2322: Type X is not assignable to Y.',
    );
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.path).toBe('src/foo.ts');
    expect(f.line).toBe(12);
    expect(f.detector).toContain('TS2322');
    expect(f.message).toMatch(/not assignable/i);
    expect(f.severity).toBe('error');

    // Two diagnostics => two findings.
    const two = parseTscFindings(
      'src/a.ts(1,1): error TS1000: A is bad.\nsrc/b.ts(2,2): error TS2000: B is bad.',
    );
    expect(two).toHaveLength(2);

    // A clean (empty) tsc run yields no findings.
    expect(parseTscFindings('')).toEqual([]);
  });

  // AC1 — ESLint JSON formatter.
  it('[covers:F-b7873005/AC-6931d251] TypeScript, ESLint, and Vitest machine output retains structured locations and raw stage output', () => {
    const json = JSON.stringify([
      {filePath: 'a.ts', messages: [{line: 3, ruleId: 'no-console', message: 'no console', severity: 2}]},
    ]);
    const findings = parseEslintFindings(json);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const f = findings[0]!;
    expect(f.path).toBe('a.ts');
    expect(f.line).toBe(3);
    expect(f.detector).toBe('no-console');
    expect(f.severity).toBe('error'); // eslint severity 2 => error

    // eslint severity 1 => warn
    const warnJson = JSON.stringify([
      {filePath: 'b.ts', messages: [{line: 5, ruleId: 'eqeqeq', message: 'use ===', severity: 1}]},
    ]);
    const warnFindings = parseEslintFindings(warnJson);
    expect(warnFindings.length).toBeGreaterThanOrEqual(1);
    expect(warnFindings[0]!.severity).toBe('warn');

    const tsc = parseTscFindings('src/types.ts(7,2): error TS2322: incompatible');
    expect(tsc[0]).toMatchObject({path: 'src/types.ts', line: 7, detector: 'TS2322', severity: 'error'});
    const vitest = parseVitestFindings(` FAIL  tests/x.test.ts > x\n   ${ARROW} tests/x.test.ts:9:3`);
    expect(vitest[0]).toMatchObject({path: 'tests/x.test.ts', line: 9});
    const raw = 'src/types.ts(7,2): error TS2322: incompatible';
    const stage = withFindings('type', {pass: false, exitCode: 1, stderr: raw} as StageResult, {stdout: '', stderr: raw});
    expect(stage.findings?.[0]).toMatchObject({path: 'src/types.ts', line: 7, detector: 'TS2322'});
    expect(stage.stderr).toBe(raw);
  });

  // AC1 — ESLint stylish (best-effort text).
  it('AC1-eslint-stylish: best-effort extraction of line/message/severity', () => {
    const stylish = 'a.ts\n  12:7  error  Unexpected console statement  no-console\n';
    const findings = parseEslintFindings(stylish);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    // Do not over-assert the path for stylish; assert line + message + severity.
    expect(findings.some((x) => x.line === 12)).toBe(true);
    const f = findings.find((x) => x.line === 12)!;
    expect(f.line).toBe(12);
    expect(f.message).toMatch(/console/i);
    expect(f.severity).toBe('error');
  });

  // AC1 — Vitest default reporter.
  it('AC1-vitest: picks the test-file frame, not a node_modules frame', () => {
    const block = [
      ' FAIL  src/x.test.ts > suite > case',
      '   ' + ARROW + ' src/x.test.ts:12:20',
    ].join('\n');
    const findings = parseVitestFindings(block);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const f = findings[0]!;
    expect(f.path).toBe('src/x.test.ts');
    expect(f.line).toBe(12);

    // A node_modules stack frame must not be chosen as the location.
    const withNodeModules = [
      ' FAIL  src/x.test.ts > suite > case',
      '   ' + ARROW + ' node_modules/vitest/dist/index.js:99:1',
      '   ' + ARROW + ' src/x.test.ts:12:20',
    ].join('\n');
    const nm = parseVitestFindings(withNodeModules);
    expect(nm.some((x) => x.path === 'src/x.test.ts' && x.line === 12)).toBe(true);
    expect(nm.every((x) => !(x.path ?? '').includes('node_modules'))).toBe(true);
  });

  // AC2 — synthetic finding when a failing stage parses nothing.
  it('[covers:F-b7873005/AC-20b69848] AC2-synthetic: non-zero exit + unparseable output => ONE path-less finding', () => {
    const raw = 'gibberish that no parser recognizes';
    const synthetic = parseToolFindings('type', '', raw, 1);
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]!.message).toContain(raw);
    expect(synthetic[0]!.path).toBeUndefined();

    // Exit 0 (stage did not fail) => no synthetic finding.
    expect(parseToolFindings('type', '', 'gibberish', 0)).toEqual([]);
  });

  // AC5 — no side effect: the money lock.
  it('AC5-no-side-effect: green result returned unchanged (same reference)', () => {
    const green = {pass: true, exitCode: 0} as unknown as StageResult;
    const returned = withFindings('type', green, {stdout: 'irrelevant', stderr: ''});
    expect(Object.is(returned, green)).toBe(true);

    // A red tool stage with parseable output gets findings; raw stderr preserved.
    const rawErr = 'src/foo.ts(1,1): error TS1005: X';
    const red = {pass: false, exitCode: 2, stderr: rawErr} as unknown as StageResult;
    const out = withFindings('type', red, {stdout: '', stderr: rawErr});
    expect(out.findings).toBeDefined();
    expect(out.findings!.length).toBeGreaterThan(0);
    expect(out.stderr).toBe(rawErr); // raw output preserved, not rewritten
  });

  it('[covers:F-b7873005/AC-bd425422] unrecognized failing output preserves the raw gate result and degrades without throwing', () => {
    const raw = 'non-machine compiler prose';
    const result = {pass: false, exitCode: 1, stderr: raw} as StageResult;
    let enriched: StageResult | undefined;
    expect(() => {
      enriched = withFindings('type', result, {stdout: '', stderr: raw});
    }).not.toThrow();
    expect(enriched).toMatchObject({pass: false, exitCode: 1, stderr: raw});
    expect(enriched?.findings).toHaveLength(1);
    expect(enriched?.findings?.[0]?.path).toBeUndefined();
  });

  // AC4 — soundness / total-safe: never throws on adversarial input.
  it('AC4-total-safe: parsers never throw and always return an array', () => {
    const huge = 'x'.repeat(100_000);
    expect(() => parseToolFindings('lint', huge, '', 1)).not.toThrow();
    expect(Array.isArray(parseToolFindings('lint', huge, '', 1))).toBe(true);

    // NUL (0x00) + replacement char, built from ASCII source (no raw NUL on disk).
    const weird = NUL + REPLACEMENT + ' garbage';
    expect(() => parseToolFindings('unit', weird, '', 1)).not.toThrow();
    expect(Array.isArray(parseToolFindings('unit', weird, '', 1))).toBe(true);

    // No individual parser throws on adversarial input.
    const adversarial = [
      '',
      '{',
      '[]',
      ']{[',
      NUL + REPLACEMENT,
      'y'.repeat(50_000),
      ' FAIL \n   ' + ARROW + ' \n',
      'src/x(:,): error',
      '{"filePath": bad json',
    ];
    for (const s of adversarial) {
      expect(() => parseTscFindings(s)).not.toThrow();
      expect(() => parseEslintFindings(s)).not.toThrow();
      expect(() => parseVitestFindings(s)).not.toThrow();
      expect(Array.isArray(parseTscFindings(s))).toBe(true);
      expect(Array.isArray(parseEslintFindings(s))).toBe(true);
      expect(Array.isArray(parseVitestFindings(s))).toBe(true);
    }

    // Every finding's severity, when present, is a valid enum member.
    for (const f of parseTscFindings('src/z.ts(1,1): error TS1: boom')) {
      expect(SEVERITIES).toContain(f.severity);
    }
  });
});
