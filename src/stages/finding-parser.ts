// Cladding · stages · tool-output finding parser (F-b7873005)
//
// Turns a FAILING tool stage's OWN captured output (tsc / eslint / vitest) into
// structured {@link DriftFinding}s carrying `path`, `line`, `detector` (the
// tool's rule id) and `message`. The verdict reducer (src/verdict/verdict.ts,
// F-2e28cc72) already prefers the first path-bearing finding on a blocking
// stage; populating `findings[]` here makes `next_action` a structured
// `file:line` instead of the raw stderr tail — with NO change to the reducer.
//
// SOUNDNESS LOCK (AC-0fa3265d): parse ONLY the tool's own textual output. No
// second AST/compiler pass, no `ts.createProgram` — a finding must never
// contradict what the tool reported, and must never re-derive a TS-only view
// that breaks the polyglot contract.
//
// NO-SIDE-EFFECT LOCK (AC-bd425422): this module is ADDITIVE. Pass/fail stays
// owned by the tool's exit code; the stage keeps its raw output verbatim. Every
// parser is pure and total — it returns `[]` (never throws) on unrecognized
// input, and the dispatcher wraps each in try/catch so a parser bug can never
// crash a stage or flip green↔red.

import type {DriftFinding, StageResult} from './types.js';

/** Strips ANSI SGR escapes so a `--pretty`/colorized tool output still parses. */
const ANSI = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

/** First non-empty (ANSI-stripped, trimmed) line of a blob, or undefined. */
function firstNonEmptyLine(s: string): string | undefined {
  for (const line of s.split(/\r?\n/)) {
    const t = stripAnsi(line).trim();
    if (t) return t;
  }
  return undefined;
}

// TypeScript compiler — the default (non-TTY) diagnostic line:
//   src/foo.ts(12,7): error TS2322: Type 'number' is not assignable to 'string'.
const TSC_PLAIN = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/;
// tsc `--pretty` header line (defensive; execaSync is non-TTY so plain is the
// default, but a user gate may force pretty):
//   src/foo.ts:12:7 - error TS2322: Type ...
const TSC_PRETTY = /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/;

/**
 * Parses `tsc` (or a tsc-compatible) diagnostic dump into findings. Only the
 * `path(line,col): error TSxxxx: msg` heads are captured — continuation lines
 * (multi-line messages, code frames) carry no location and are ignored, so one
 * error yields exactly one finding. The `detector` is the tool's own rule (the
 * TS error code), satisfying "path, line, rule, message" (AC-6931d251).
 */
export function parseTscFindings(output: string): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const line = stripAnsi(raw);
    const m = TSC_PLAIN.exec(line) ?? TSC_PRETTY.exec(line);
    if (!m) continue;
    const path = m[1].trim();
    const ln = Number(m[2]);
    const detector = m[4];
    const message = m[5].trim();
    const key = `${path}:${ln}:${detector}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({detector, severity: 'error', path, line: ln, message});
  }
  return findings;
}

/** ESLint JSON reporter row: `[{filePath, messages:[{line, ruleId, message, severity}]}]`. */
interface EslintJsonFile {
  readonly filePath?: string;
  readonly messages?: readonly {
    readonly line?: number;
    readonly ruleId?: string | null;
    readonly message?: string;
    readonly severity?: number;
  }[];
}

/** Parses ESLint `--format json` output, or returns null when it is not JSON. */
function parseEslintJson(text: string): DriftFinding[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const findings: DriftFinding[] = [];
  for (const file of parsed as EslintJsonFile[]) {
    const path = file.filePath;
    for (const msg of file.messages ?? []) {
      // severity 2 = error, 1 = warning (ESLint's numeric scale).
      const severity: DriftFinding['severity'] = msg.severity === 1 ? 'warn' : 'error';
      const finding: DriftFinding = {
        detector: msg.ruleId ?? 'LINT',
        severity,
        message: (msg.message ?? '').trim() || 'lint problem',
        ...(path ? {path} : {}),
        ...(msg.line !== undefined ? {line: msg.line} : {}),
      };
      findings.push(finding);
    }
  }
  return findings;
}

// Stylish header line = a bare file path (no leading whitespace, not a summary).
const ESLINT_SUMMARY = /^[✖✗×]\s|\bproblems?\b|\bpotentially fixable\b/;
// Stylish detail line: `  12:7  error  Unexpected console statement  no-console`
const ESLINT_STYLISH = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([@\w][\w./-]*))?\s*$/;

/**
 * Parses ESLint output. Tries the `--format json` shape first (in case a gate
 * opts into it); otherwise best-effort over the default `stylish` formatter.
 * Returns `[]` on anything it does not recognize — the dispatcher then applies
 * the synthetic raw-tail fallback (AC-20b69848). Also covers biome/oxlint text
 * output loosely; unrecognized formatters simply fall back to raw.
 */
export function parseEslintFindings(jsonOrText: string): DriftFinding[] {
  const json = parseEslintJson(jsonOrText);
  if (json) return json;
  const findings: DriftFinding[] = [];
  let currentFile: string | undefined;
  for (const raw of jsonOrText.split(/\r?\n/)) {
    const line = stripAnsi(raw);
    const detail = ESLINT_STYLISH.exec(line);
    if (detail) {
      const severity: DriftFinding['severity'] = detail[3] === 'warning' ? 'warn' : 'error';
      const finding: DriftFinding = {
        detector: detail[5] ?? 'LINT',
        severity,
        message: detail[4].trim() || 'lint problem',
        ...(currentFile ? {path: currentFile} : {}),
        line: Number(detail[1]),
      };
      findings.push(finding);
      continue;
    }
    const trimmed = line.trim();
    // A non-indented, non-summary, non-blank line that names a path is a header.
    if (trimmed && !/^\s/.test(line) && !ESLINT_SUMMARY.test(trimmed) && /[\\/.]/.test(trimmed)) {
      currentFile = trimmed;
    }
  }
  return findings;
}

// Vitest default reporter — the per-failure header and the assertion frame:
//   FAIL  src/foo.test.ts > my suite > does a thing
//    ❯ src/foo.test.ts:12:20
const VITEST_FAIL = /^\s*(?:[×✗]\s+)?FAIL\s+(\S+?)(?:\s+>\s+(.+))?\s*$/;
const VITEST_FRAME = /^\s*❯\s+(\S+?):(\d+):(\d+)/;

/** Vitest JSON reporter (jest-shaped) file record. */
interface VitestJsonAssertion {
  readonly status?: string;
  readonly fullName?: string;
  readonly title?: string;
  readonly location?: {readonly line?: number} | null;
}
interface VitestJsonFile {
  readonly name?: string;
  readonly assertionResults?: readonly VitestJsonAssertion[];
}

/** Parses vitest `--reporter=json` output, or returns null when it is not JSON. */
function parseVitestJson(text: string): DriftFinding[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const results = (parsed as {testResults?: readonly VitestJsonFile[]}).testResults;
  if (!Array.isArray(results)) return null;
  const findings: DriftFinding[] = [];
  for (const file of results) {
    const path = file.name;
    for (const a of file.assertionResults ?? []) {
      if (a.status !== 'failed') continue;
      const finding: DriftFinding = {
        detector: 'UNIT',
        severity: 'error',
        message: (a.fullName ?? a.title ?? 'unit test failed').trim(),
        ...(path ? {path} : {}),
        ...(a.location?.line !== undefined ? {line: a.location.line} : {}),
      };
      findings.push(finding);
    }
  }
  return findings;
}

/**
 * Parses vitest output. Tries the `--reporter=json` shape first; otherwise
 * best-effort over the default reporter — pairing each `FAIL <path> > <name>`
 * header with the first `❯ <path>:<line>:<col>` stack frame that points into
 * project source (node_modules frames are skipped). Returns `[]` when nothing
 * recognizable is found.
 */
export function parseVitestFindings(output: string): DriftFinding[] {
  const json = parseVitestJson(output);
  if (json) return json;
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();
  let pending: string | undefined;
  for (const raw of output.split(/\r?\n/)) {
    const line = stripAnsi(raw);
    const fail = VITEST_FAIL.exec(line);
    if (fail) {
      pending = (fail[2] ?? fail[1]).trim();
      continue;
    }
    const frame = VITEST_FRAME.exec(line);
    if (frame) {
      const path = frame[1];
      if (path.includes('node_modules')) continue;
      const ln = Number(frame[2]);
      const key = `${path}:${ln}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        detector: 'UNIT',
        severity: 'error',
        path,
        line: ln,
        message: pending ?? 'unit test failed',
      });
      // One finding per FAIL block — later frames are the caller stack, noise.
      pending = undefined;
    }
  }
  return findings;
}

/** The synthetic-finding detector id per tool kind (used for the raw-tail fallback). */
const KIND_DETECTOR: Record<'type' | 'lint' | 'unit', string> = {
  type: 'TYPE',
  lint: 'LINT',
  unit: 'UNIT',
};

/**
 * Routes a tool stage's captured output to its parser and applies the AC-20b69848
 * synthetic raw-tail fallback: when the stage FAILED (exitCode ≠ 0) but no
 * finding parsed, emit ONE synthetic finding from the first non-empty raw line
 * so "no structure" never reads as "no problem." The synthetic finding carries
 * no `path`, so the verdict reducer keeps its existing raw-tail behavior for
 * next_action — the stage's on-screen/JSON view still shows a structured pointer.
 *
 * TOTAL & SAFE: every parser call is wrapped; any throw degrades to `[]` (then
 * the fallback), never a stage crash or a flipped gate outcome (AC-bd425422).
 *
 * @param kind - Which tool ran (drives the parser + synthetic detector id).
 * @param stdout - The tool's captured stdout (tsc/eslint write diagnostics here).
 * @param stderr - The tool's captured stderr.
 * @param exitCode - The stage's mapped exit code (≠ 0 arms the raw-tail fallback).
 */
export function parseToolFindings(
  kind: 'type' | 'lint' | 'unit',
  stdout: string,
  stderr: string,
  exitCode: number,
): DriftFinding[] {
  // tsc/eslint write to stdout, others may split — parse the union of both.
  const combined = [stdout, stderr].filter((s) => s && s.trim()).join('\n');
  let findings: DriftFinding[] = [];
  try {
    switch (kind) {
      case 'type':
        findings = parseTscFindings(combined);
        break;
      case 'lint':
        findings = parseEslintFindings(combined);
        break;
      case 'unit':
        findings = parseVitestFindings(combined);
        break;
    }
  } catch {
    findings = [];
  }
  if (findings.length > 0) return findings;
  // AC-20b69848 — failed, but nothing parsed: surface a single raw-tail pointer.
  if (exitCode !== 0) {
    // Mirror ranToolResult's kept-detail order (stderr, then stdout).
    const tail = firstNonEmptyLine(stderr.trim() || stdout.trim());
    if (tail) return [{detector: KIND_DETECTOR[kind], severity: 'error', message: tail}];
  }
  return [];
}

/**
 * Stage-wiring helper: on a FAILING tool stage, parse the tool's own captured
 * output into structured findings and attach them to the result, PRESERVING the
 * raw `stderr` untouched. On a green stage (`result.pass`) nothing is attached —
 * behavior is byte-for-byte unchanged. `parseToolFindings` is total (never
 * throws), so this can never crash a stage or flip the gate outcome (AC-bd425422).
 *
 * @param kind - Which tool ran (type/lint/unit).
 * @param result - The stage result from `ranToolResult`.
 * @param proc - The `execaSync(…, {reject:false})` value (for stdout/stderr).
 */
export function withFindings(
  kind: 'type' | 'lint' | 'unit',
  result: StageResult,
  proc: {readonly stdout?: unknown; readonly stderr?: unknown},
): StageResult {
  if (result.pass) return result;
  const findings = parseToolFindings(
    kind,
    String(proc.stdout ?? ''),
    String(proc.stderr ?? ''),
    result.exitCode,
  );
  return findings.length > 0 ? {...result, findings} : result;
}
