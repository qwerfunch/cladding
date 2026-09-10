// Cladding · `clad doctor --hosts` — host-support smoke matrix (F-5283985e)
//
// Host verification used to rely on hand-written dogfood docs that could go
// stale, leave supported hosts deferred, or over-claim a README table row.
// This module makes every host-support claim trace to a DATED, machine-produced
// smoke artifact instead of prose:
//
//   • runHostSmoke  — probes claude / gemini / agy / codex / cursor-agent CLIs (≤3 canned
//                     one-shot prompts each), recording per-host
//                     pass / fail / not-run with the observed sentinel evidence.
//   • renderHostMatrix — pure renderer → docs/dogfood/matrix.md.
//   • parseHostOutput  — PURE sentinel matcher, split out so committed transcript
//                     fixtures regression-test the parser with ZERO live LLM calls.
//
// Honesty invariants (AC-8dfa9cc4, AC-6cbe51fc):
//   - Absence of evidence renders as `not-run`, NEVER `pass`. A binary that is
//     not on PATH, or a run without consent, is not-run — not a silent green.
//   - Live prompts run ONLY with explicit consent (CLAD_HOST_SMOKE=1 or --yes).
//   - Cursor's headless Agent CLI is prompt-probed like every other supported
//     host; its MCP wiring is additionally checked without spending model tokens.

import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {homedir, platform} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';

import {GEMINI_DOCTOR_POLICY_RELATIVE, getCurrentCladdingVersion} from '../init/host-setup.js';
import {featureIdRe} from '../spec/feature-id.js';
import {loadSpec} from '../spec/load.js';
import {pulse} from '../ui/pulse.js';

// ────────────────────────────────────────────────────────────────────────────
// Types — the artifact wire format (stable; new fields are additive).
// ────────────────────────────────────────────────────────────────────────────

/** The three prompt-probed MCP surfaces each headless host CLI is smoke-tested against. */
export type SurfaceName = 'list-features' | 'get-feature' | 'run-check';

/** Per-surface disposition. `not-run` = absence of evidence, never a pass. */
export type SurfaceResultKind = 'pass' | 'fail' | 'not-run';

/** One host's overall grade in the matrix. */
export type HostGrade = 'verified' | 'fail' | 'not-run' | 'wiring-ok' | 'wiring-fail';

/** The prompt-probed CLI hosts (each has a headless one-shot surface). */
export const PROMPT_HOSTS = ['claude', 'gemini', 'antigravity', 'codex', 'cursor'] as const;
export type PromptHost = (typeof PROMPT_HOSTS)[number];

/** Result of matching one surface's output against its sentinel. */
export interface SurfaceParse {
  readonly result: 'pass' | 'fail';
  /** Human description of what the sentinel looked for. */
  readonly sentinel: string;
  /** Captured output tail, whitespace-collapsed, ≤200 chars. */
  readonly evidence: string;
}

/** One row of a host's smoke record. */
export interface SurfaceRecord {
  /** Surface identifier — a SurfaceName, or `wiring` for the Cursor MCP check. */
  readonly name: string;
  readonly result: SurfaceResultKind;
  readonly sentinel: string;
  readonly evidence: string;
}

export interface HostRecord {
  readonly grade: HostGrade;
  readonly surfaces: readonly SurfaceRecord[];
  /** Why the host was graded as it was (populated for not-run / wiring-fail). */
  readonly reason?: string;
}

/** The dated artifact written under `.cladding/audit/host-smoke-<ISO-date>.json`. */
export interface HostSmokeArtifact {
  readonly version: string;
  readonly generatedAt: string;
  readonly hosts: {
    readonly claude: HostRecord;
    readonly gemini: HostRecord;
    readonly antigravity: HostRecord;
    readonly codex: HostRecord;
    readonly cursor: HostRecord;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Sentinels — the PURE parser surface (AC-57ab708c). No I/O, no LLM.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Sentinel per surface. The prompts target cladding's MCP tools; a real answer
 * echoes a recognisable token:
 *   - list-features → a real feature id accepted by the central reader policy
 *   - get-feature   → the QUERIED id echoed back (dynamic — see parseHostOutput)
 *   - run-check     → a drift verdict keyword (drift / finding / GREEN / RED)
 */
export const SURFACE_SENTINELS: Readonly<Record<SurfaceName, {pattern: RegExp; label: string}>> = {
  'list-features': {pattern: featureIdRe(), label: 'a real feature identifier'},
  'get-feature': {pattern: featureIdRe(), label: 'the queried feature identifier echoed'},
  // Word-bounded on purpose: the first live run's /RED/i matched the "red"
  // inside "occurred" in a gemini crash trace — a surface-level vacuous green.
  // GREEN/RED stay uppercase-only (verdict tokens); drift/finding(s) allow a
  // leading capital.
  'run-check': {
    pattern: /\b[Dd]rift\b|\b[Ff]indings?\b|\bGREEN\b|\bRED\b/,
    label: 'a drift verdict (drift/findings/GREEN/RED)',
  },
};

/** Collapse whitespace and keep the last `max` chars — the evidence tail. */
export function tail(text: string, max = 200): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : collapsed.slice(-max);
}

/**
 * PURE sentinel matcher (AC-57ab708c). Given a surface, the captured host output,
 * and — for get-feature — the id we asked about, decide pass/fail and carry the
 * evidence tail. Committed transcript fixtures drive this with zero live calls.
 *
 * @param surface    Which MCP surface the prompt targeted.
 * @param text       Combined stdout+stderr of the host CLI (may be empty).
 * @param expectedId For get-feature, the feature id the prompt queried; when
 *                   present the sentinel is that literal id echoed, else the
 *                   generic feature-id pattern.
 */
export function parseHostOutput(surface: SurfaceName, text: string, expectedId?: string): SurfaceParse {
  const refusal =
    /\b(?:MCP|tool|clad_[a-z0-9_]+)(?:\s+tool)?(?:\s+calls?)?[^.\n]{0,80}\b(?:rejected|denied|refused|cancelled|canceled|not approved)\b|\buser cancelle?d MCP tool call\b|\bno tool payload\b|\bdon't have a findings count\b|\bre-approve the cladding MCP tool\b/i;
  if (refusal.test(text)) {
    return {
      result: 'fail',
      sentinel: SURFACE_SENTINELS[surface].label,
      evidence: tail(text),
    };
  }
  let pattern = SURFACE_SENTINELS[surface].pattern;
  let label = SURFACE_SENTINELS[surface].label;
  if (surface === 'get-feature' && expectedId) {
    // Feature ids are emitted from a restricted policy alphabet, so quoting the
    // requested value gives the exact echo sentinel without a broad matcher.
    pattern = new RegExp(expectedId);
    label = `the queried id ${expectedId} echoed`;
  }
  return {
    result: pattern.test(text) ? 'pass' : 'fail',
    sentinel: label,
    evidence: tail(text),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt definitions — one canned one-shot per surface, ≤3 per host.
// ────────────────────────────────────────────────────────────────────────────

/**
 * The canned prompts, derived from the original host dogfood recipes, then
 * hardened after the first live
 * run: an open-ended "list the first 3 features" invited the host to explore
 * project context instead of calling the tool, grading a healthy host `fail`.
 * Maximally directive + context-proof: name the exact MCP tool, demand the
 * sentinel token verbatim, forbid anything else.
 */
export const SURFACE_PROMPTS: Readonly<Record<SurfaceName, (id: string) => string>> = {
  'list-features': () =>
    'Call the clad_list_features MCP tool and print exactly one feature id (format F-xxxxxxxx) from the result, nothing else.',
  'get-feature': (id) => `Call the clad_get_feature MCP tool for id ${id} and print that id verbatim.`,
  'run-check': () =>
    "Call the clad_run_check MCP tool and print the number of findings plus the word 'findings'.",
};

/**
 * How each host CLI runs a single non-interactive prompt. The smoke only ever
 * fires behind explicit consent (CLAD_HOST_SMOKE=1 / --yes), which is why the
 * non-interactive approval bypasses below are acceptable here and nowhere else:
 * a headless probe cannot answer a host's approval prompt, and each probed
 * cladding tool is one of the three read-only doctor surfaces.
 *   - claude → `claude -p "<prompt>" --output-format text --settings <auto-approve project .mcp.json>`
 *   - gemini → `gemini --skip-trust --approval-mode plan --policy <project-policy> -o text -p "<prompt>"`
 *   - antigravity → `agy --dangerously-skip-permissions -p "<prompt>"` (in the project cwd — agy's
 *     machine-wide wire resolves the project from the session directory)
 *   - codex  → `codex exec --dangerously-bypass-approvals-and-sandbox "<prompt>"`
 *   - cursor → `cursor-agent -p --mode ask --trust --approve-mcps "<prompt>"`
 */
export function buildPromptCommand(host: PromptHost, prompt: string): {command: string; args: string[]} {
  switch (host) {
    case 'claude':
      return {command: 'claude', args: ['-p', prompt, '--output-format', 'text', '--settings', '{"enableAllProjectMcpServers":true}']};
    case 'gemini':
      return {
        command: 'gemini',
        args: [
          '--skip-trust',
          '--approval-mode',
          'plan',
          '--policy',
          GEMINI_DOCTOR_POLICY_RELATIVE,
          '--allowed-mcp-server-names',
          'cladding',
          '-o',
          'text',
          '-p',
          prompt,
        ],
      };
    case 'antigravity':
      return {command: 'agy', args: ['--dangerously-skip-permissions', '-p', prompt]};
    case 'codex':
      return {command: 'codex', args: ['exec', '--dangerously-bypass-approvals-and-sandbox', prompt]};
    case 'cursor':
      return {command: 'cursor-agent', args: ['-p', '--mode', 'ask', '--trust', '--approve-mcps', prompt]};
  }
}

/** Executable name corresponding to a public host key. */
function hostBinary(host: PromptHost): string {
  return host === 'antigravity' ? 'agy' : host === 'cursor' ? 'cursor-agent' : host;
}

// ────────────────────────────────────────────────────────────────────────────
// Injectable runners — the seams that keep runHostSmoke unit-testable without
// spawning real host CLIs or a real MCP server.
// ────────────────────────────────────────────────────────────────────────────

/** Outcome of running one host CLI prompt. */
export interface PromptResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly code: number | null;
}

/** Runs one host CLI prompt with a hard timeout. Injectable for tests. */
export type PromptRunner = (
  command: string,
  args: readonly string[],
  ctx: {readonly cwd: string; readonly timeoutMs: number},
) => PromptResult;

/** Result of the Cursor MCP wiring probe. */
export interface ServeProbeResult {
  readonly ok: boolean;
  readonly toolCount: number;
  readonly evidence: string;
}

/** Speaks JSON-RPC initialize + tools/list to a serve command. Injectable for tests. */
export type ServeProber = (command: string, args: readonly string[], cwd: string) => ServeProbeResult;

export interface HostSmokeOptions {
  /** Live prompts run only when true (CLAD_HOST_SMOKE=1 or --yes). */
  readonly consent?: boolean;
  /** Home directory used only for host binary discovery and legacy diagnostics. */
  readonly home?: string;
  /** Clock injection for deterministic artifact timestamps in tests. */
  readonly now?: Date;
  /** Cladding version stamp (default: resolved from the binary's package.json). */
  readonly version?: string;
  /** Detects whether a binary is on PATH (default: which/where). Injectable. */
  readonly hasBinary?: (name: string) => boolean;
  /** Runs a host CLI prompt (default: spawnSync). Injectable. */
  readonly runPrompt?: PromptRunner;
  /** Probes `clad serve` tools/list over stdio (default: spawnSync JSON-RPC). Injectable. */
  readonly probeServe?: ServeProber;
}

/** run-check executes the project's full gate inside the host turn — give it
 * the room a real repository needs instead of grading slowness as failure. */
const PROMPT_TIMEOUT_MS: Readonly<Record<SurfaceName, number>> = {
  'list-features': 120_000,
  'get-feature': 120_000,
  'run-check': 300_000,
};
const SERVE_TIMEOUT_MS = 10_000;

function defaultHasBinary(name: string): boolean {
  const cmd = platform() === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, [name], {stdio: 'ignore'});
  return r.status === 0;
}

function defaultRunPrompt(
  command: string,
  args: readonly string[],
  ctx: {cwd: string; timeoutMs: number},
): PromptResult {
  const r = spawnSync(command, [...args], {
    cwd: ctx.cwd,
    encoding: 'utf8',
    timeout: ctx.timeoutMs,
    shell: platform() === 'win32',
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    timedOut: r.signal === 'SIGTERM' || (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
    code: r.status,
  };
}

/**
 * Default serve prober — spawns the wired serve command and speaks newline-
 * delimited MCP JSON-RPC (initialize → initialized → tools/list). spawnSync
 * writes all three messages then closes stdin; the SDK's StdioServerTransport
 * processes the buffered lines in order and flushes each response before the
 * EOF-triggered shutdown, so a single synchronous call captures the tools list.
 */
function defaultProbeServe(command: string, args: readonly string[], cwd: string): ServeProbeResult {
  const initialize = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {name: 'clad-doctor-hosts', version: '1'},
    },
  });
  const initialized = JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'});
  const toolsList = JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}});
  const input = `${initialize}\n${initialized}\n${toolsList}\n`;
  const r = spawnSync(command, [...args], {
    cwd,
    input,
    encoding: 'utf8',
    timeout: SERVE_TIMEOUT_MS,
    shell: platform() === 'win32',
  });
  return parseServeToolsList(r.stdout ?? '', r.stderr ?? '');
}

/** PURE — parse the serve stdout for the tools/list (id:2) response. */
export function parseServeToolsList(stdout: string, stderr = ''): ServeProbeResult {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const obj = msg as {id?: unknown; result?: {tools?: unknown}};
    if (obj.id !== 2) continue;
    const tools = obj.result?.tools;
    if (Array.isArray(tools)) {
      const names = tools.map((t) => (t as {name?: string}).name).filter(Boolean) as string[];
      return {
        ok: names.includes('clad_list_features'),
        toolCount: tools.length,
        evidence: tail(`tools/list → ${tools.length} tools: ${names.slice(0, 6).join(', ')}`),
      };
    }
  }
  return {ok: false, toolCount: 0, evidence: tail(stderr || stdout || 'no tools/list response from clad serve')};
}

// ────────────────────────────────────────────────────────────────────────────
// runHostSmoke — the orchestrator.
// ────────────────────────────────────────────────────────────────────────────

/** Pick a real feature id to query for the get-feature surface. */
function pickFeatureId(cwd: string): string | null {
  try {
    const spec = loadSpec(cwd);
    return spec.features?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Build a not-run record for all three prompt surfaces with a shared reason. */
function notRunPromptHost(reason: string): HostRecord {
  const surfaces: SurfaceRecord[] = (Object.keys(SURFACE_SENTINELS) as SurfaceName[]).map((name) => ({
    name,
    result: 'not-run',
    sentinel: SURFACE_SENTINELS[name].label,
    evidence: '',
  }));
  return {grade: 'not-run', surfaces, reason};
}

/** Probe one headless host CLI with consent + binary present. */
function probePromptHost(
  host: PromptHost,
  cwd: string,
  featureId: string | null,
  runPrompt: PromptRunner,
): HostRecord {
  const surfaces: SurfaceRecord[] = [];
  for (const name of Object.keys(SURFACE_SENTINELS) as SurfaceName[]) {
    if (name === 'get-feature' && !featureId) {
      surfaces.push({
        name,
        result: 'not-run',
        sentinel: SURFACE_SENTINELS[name].label,
        evidence: 'no feature available to query (empty spec)',
      });
      continue;
    }
    const prompt = SURFACE_PROMPTS[name](featureId ?? '');
    const {command, args} = buildPromptCommand(host, prompt);
    const r = runPrompt(command, args, {cwd, timeoutMs: PROMPT_TIMEOUT_MS[name]});
    if (r.timedOut) {
      surfaces.push({
        name,
        result: 'fail',
        sentinel: SURFACE_SENTINELS[name].label,
        evidence: tail(`timed out after ${PROMPT_TIMEOUT_MS[name] / 1000}s: ${r.stderr || r.stdout}`),
      });
      continue;
    }
    if (r.code !== 0) {
      // Exit-code gate — a crashed/refused CLI can never pass, no matter what
      // its output text accidentally matches (a live host crash once emitted a
      // trace that still matched a loose sentinel).
      surfaces.push({
        name,
        result: 'fail',
        sentinel: SURFACE_SENTINELS[name].label,
        evidence: tail(`exit ${r.code ?? 'signal'}: ${r.stderr || r.stdout}`),
      });
      continue;
    }
    const combined = `${r.stdout}\n${r.stderr}`;
    const parse = parseHostOutput(name, combined, name === 'get-feature' ? featureId ?? undefined : undefined);
    surfaces.push({name, result: parse.result, sentinel: parse.sentinel, evidence: parse.evidence});
  }
  const anyFail = surfaces.some((s) => s.result === 'fail');
  const anyPass = surfaces.some((s) => s.result === 'pass');
  const grade: HostGrade = anyFail ? 'fail' : anyPass ? 'verified' : 'not-run';
  return {grade, surfaces};
}

/**
 * Cursor wiring probe (AC-6cbe51fc). No consent needed — it is free and local.
 * The prompt probe supplies the overall host grade; this adds structural MCP
 * evidence and catches a dead configured server before spending model tokens.
 * Wiring grades:
 *   - not-run    — no project-local Cladding MCP entry. Absence of evidence,
 *                  never a pass.
 *   - wiring-fail — cladding IS wired but `clad serve` does not answer tools/list.
 *   - wiring-ok  — wired AND `clad serve` answers a tools list over stdio.
 */
function probeCursorWiring(_home: string, cwd: string, probeServe: ServeProber): HostRecord {
  const cursorDir = join(cwd, '.cursor');
  const mcpPath = join(cursorDir, 'mcp.json');
  if (!existsSync(mcpPath)) {
    return {grade: 'not-run', surfaces: [], reason: 'no project .cursor/mcp.json — run `clad setup` in this project'};
  }
  let entry: {command?: string; args?: unknown} | undefined;
  try {
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf8')) as {mcpServers?: Record<string, unknown>};
    entry = parsed.mcpServers?.cladding as {command?: string; args?: unknown} | undefined;
  } catch {
    return {grade: 'not-run', surfaces: [], reason: 'project .cursor/mcp.json is not valid JSON'};
  }
  if (!entry || typeof entry.command !== 'string') {
    return {grade: 'not-run', surfaces: [], reason: 'no Cladding entry in project .cursor/mcp.json — run `clad setup`'};
  }
  const args = Array.isArray(entry.args) ? (entry.args as string[]) : [];
  const probe = probeServe(entry.command, args, cwd);
  const surface: SurfaceRecord = {
    name: 'wiring',
    result: probe.ok ? 'pass' : 'fail',
    sentinel: 'clad serve answers tools/list including clad_list_features',
    evidence: probe.evidence,
  };
  return probe.ok
    ? {grade: 'wiring-ok', surfaces: [surface]}
    : {grade: 'wiring-fail', surfaces: [surface], reason: 'Cladding is wired in project .cursor/mcp.json but its launcher did not answer tools/list'};
}

/**
 * Runs the host smoke matrix. Live host-CLI prompts run only with consent;
 * absent-binary and no-consent both render `not-run` (never pass). Cursor's
 * wiring check is free/local and always runs in addition to its headless probe.
 */
export function runHostSmoke(cwd: string, opts: HostSmokeOptions = {}): HostSmokeArtifact {
  const consent = opts.consent ?? false;
  const home = opts.home ?? homedir();
  const now = opts.now ?? new Date();
  const version = opts.version ?? getCurrentCladdingVersion() ?? 'unknown';
  const hasBinary = opts.hasBinary ?? defaultHasBinary;
  const runPrompt = opts.runPrompt ?? defaultRunPrompt;
  const probeServe = opts.probeServe ?? defaultProbeServe;
  const featureId = pickFeatureId(cwd);

  const promptRecords = {} as Record<PromptHost, HostRecord>;
  for (const host of PROMPT_HOSTS) {
    if (!hasBinary(hostBinary(host))) {
      promptRecords[host] = notRunPromptHost('binary not on PATH');
    } else if (!consent) {
      promptRecords[host] = notRunPromptHost('consent not given (set CLAD_HOST_SMOKE=1)');
    } else {
      promptRecords[host] = probePromptHost(host, cwd, featureId, runPrompt);
    }
  }

  const cursorPrompt = promptRecords.cursor;
  const cursorWiring = probeCursorWiring(home, cwd, probeServe);
  const cursor: HostRecord = {
    grade:
      cursorWiring.grade === 'wiring-fail'
        ? 'fail'
        : cursorPrompt.grade,
    surfaces: [...cursorPrompt.surfaces, ...cursorWiring.surfaces],
    ...((cursorPrompt.reason || cursorWiring.reason)
      ? {reason: [cursorPrompt.reason, cursorWiring.reason].filter(Boolean).join('; ')}
      : {}),
  };

  return {
    version,
    generatedAt: now.toISOString(),
    hosts: {
      claude: promptRecords.claude,
      gemini: promptRecords.gemini,
      antigravity: promptRecords.antigravity,
      codex: promptRecords.codex,
      cursor,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Matrix renderer — PURE (AC-57ab708c). artifact → docs/dogfood/matrix.md.
// ────────────────────────────────────────────────────────────────────────────

/** Machine-readable grades fence the HOST_CLAIM_DRIFT detector reads. */
export function matrixGradesFence(artifact: HostSmokeArtifact): string {
  const grades = {
    claude: artifact.hosts.claude.grade,
    gemini: artifact.hosts.gemini.grade,
    antigravity: artifact.hosts.antigravity.grade,
    codex: artifact.hosts.codex.grade,
    cursor: artifact.hosts.cursor.grade,
  };
  return `<!-- clad:matrix-grades ${JSON.stringify(grades)} -->`;
}

function surfaceCell(record: HostRecord, name: string): string {
  const s = record.surfaces.find((x) => x.name === name);
  return s ? s.result : '—';
}

/**
 * Renders docs/dogfood/matrix.md from an artifact — host × surface × result ×
 * date × cladding version, plus the evidence legend and a machine-readable
 * grades fence for the drift detector.
 */
export function renderHostMatrix(artifact: HostSmokeArtifact): string {
  const {version, generatedAt, hosts} = artifact;
  const lines: string[] = [];
  lines.push('# Host support matrix');
  lines.push('');
  lines.push('<!-- Generated by `clad doctor --hosts`. Do not edit by hand — run the command to refresh. -->');
  lines.push(matrixGradesFence(artifact));
  lines.push('');
  lines.push(`- Cladding version: \`${version}\``);
  lines.push(`- Generated: ${generatedAt}`);
  lines.push('');
  lines.push('| Host | list-features | get-feature | run-check | wiring | Grade |');
  lines.push('|---|---|---|---|---|---|');
  const promptRow = (name: string, r: HostRecord): string =>
    `| ${name} | ${surfaceCell(r, 'list-features')} | ${surfaceCell(r, 'get-feature')} | ${surfaceCell(r, 'run-check')} | — | ${r.grade} |`;
  lines.push(promptRow('claude', hosts.claude));
  lines.push(promptRow('gemini', hosts.gemini));
  lines.push(promptRow('antigravity', hosts.antigravity));
  lines.push(promptRow('codex', hosts.codex));
  lines.push(
    `| cursor | ${surfaceCell(hosts.cursor, 'list-features')} | ${surfaceCell(hosts.cursor, 'get-feature')} | ` +
      `${surfaceCell(hosts.cursor, 'run-check')} | ${surfaceCell(hosts.cursor, 'wiring')} | ${hosts.cursor.grade} |`,
  );
  lines.push('');
  lines.push('**Legend**');
  lines.push('');
  lines.push(
    '- `verified` — every probed surface passed its sentinel end-to-end.',
  );
  lines.push(
    '- `wiring` — Cursor additionally verifies that its configured `clad serve` answers a tools list over stdio.',
  );
  lines.push(
    '- `not-run` — absence of evidence (binary absent from PATH, no live-run consent, or host not wired here). ' +
      'Never rendered as a pass — the matrix records absence honestly.',
  );
  lines.push('');
  const reasons = collectReasons(artifact);
  if (reasons.length > 0) {
    lines.push('**Why not-run / fail**');
    lines.push('');
    for (const [host, reason] of reasons) lines.push(`- \`${host}\`: ${reason}`);
    lines.push('');
  }
  lines.push(
    '> Live grades land when a human runs `clad doctor --hosts` with consent ' +
      '(`CLAD_HOST_SMOKE=1` or `--yes`). Without consent this baseline records only what is checkable ' +
      'for free — Cursor wiring — and leaves all LLM-driven surfaces `not-run`.',
  );
  lines.push('');
  return lines.join('\n');
}

function collectReasons(artifact: HostSmokeArtifact): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [host, rec] of Object.entries(artifact.hosts)) {
    if (rec.reason) out.push([host, rec.reason]);
    // Failing surfaces carry their captured evidence into the matrix — the
    // receipt must be readable without opening the artifact JSON. Deduped:
    // a crashing CLI produces the same tail on every surface.
    const failing = rec.surfaces.filter((s) => s.result === 'fail');
    const seen = new Set<string>();
    for (const s of failing) {
      if (seen.has(s.evidence)) continue;
      seen.add(s.evidence);
      const surfaceNames = failing.filter((x) => x.evidence === s.evidence).map((x) => x.name);
      out.push([host, `${surfaceNames.join(', ')} failed — ${s.evidence}`]);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Artifact + matrix I/O.
// ────────────────────────────────────────────────────────────────────────────

const AUDIT_DIR = join('.cladding', 'audit');
const MATRIX_PATH = join('docs', 'dogfood', 'matrix.md');

function artifactPath(cwd: string, generatedAt: string): string {
  const isoDate = generatedAt.slice(0, 10);
  return join(cwd, AUDIT_DIR, `host-smoke-${isoDate}.json`);
}

function writeArtifact(cwd: string, artifact: HostSmokeArtifact): string {
  const path = artifactPath(cwd, artifact.generatedAt);
  mkdirSync(join(cwd, AUDIT_DIR), {recursive: true});
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return path;
}

function writeMatrix(cwd: string, artifact: HostSmokeArtifact): string {
  const path = join(cwd, MATRIX_PATH);
  mkdirSync(join(cwd, 'docs', 'dogfood'), {recursive: true});
  writeFileSync(path, renderHostMatrix(artifact), 'utf8');
  return path;
}

/** Read the newest host-smoke artifact under .cladding/audit/, or null. */
export function readNewestArtifact(cwd: string): HostSmokeArtifact | null {
  const dir = join(cwd, AUDIT_DIR);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('host-smoke-') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const f of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
        version?: unknown;
        generatedAt?: unknown;
        hosts?: Record<string, HostRecord>;
      };
      if (typeof parsed.version !== 'string' || typeof parsed.generatedAt !== 'string' || !parsed.hosts) continue;
      const fallback = notRunPromptHost('legacy artifact predates this host probe; run `clad doctor --hosts --yes`');
      const claude = parsed.hosts.claude;
      const codex = parsed.hosts.codex;
      const cursor = parsed.hosts.cursor;
      if (!claude || !codex || !cursor) continue;
      return {
        version: parsed.version,
        generatedAt: parsed.generatedAt,
        hosts: {
          claude,
          gemini: parsed.hosts.gemini ?? fallback,
          antigravity: parsed.hosts.antigravity ?? fallback,
          codex,
          cursor,
        },
      };
    } catch {
      continue;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// CLI handler — `clad doctor --hosts` / `--matrix-only`.
// ────────────────────────────────────────────────────────────────────────────

export interface DoctorHostsOptions {
  readonly cwd?: string;
  /** Explicit consent via --yes (env CLAD_HOST_SMOKE=1 is also honoured). */
  readonly yes?: boolean;
  /** Regenerate matrix.md from the newest artifact without any probing. */
  readonly matrixOnly?: boolean;
  /** Home override (mainly for tests). */
  readonly home?: string;
}

/**
 * Handler for `clad doctor --hosts`. Writes the dated artifact + regenerates
 * docs/dogfood/matrix.md; with --matrix-only, regenerates the matrix from the
 * newest artifact without probing. Exits 0 (diagnostic surface, never a gate).
 */
export function runDoctorHosts(opts: DoctorHostsOptions = {}): void {
  const cwd = opts.cwd ?? '.';

  if (opts.matrixOnly) {
    const artifact = readNewestArtifact(cwd);
    if (!artifact) {
      pulse('note', 'doctor', 'no host-smoke artifact found — run `clad doctor --hosts` first');
      process.exit(0);
      return;
    }
    const path = writeMatrix(cwd, artifact);
    pulse('pass', 'doctor', `matrix regenerated from newest artifact → ${path}`);
    process.exit(0);
    return;
  }

  const consent = Boolean(opts.yes) || process.env.CLAD_HOST_SMOKE === '1';
  const artifact = runHostSmoke(cwd, {consent, home: opts.home});
  const artifactFile = writeArtifact(cwd, artifact);
  const matrixFile = writeMatrix(cwd, artifact);

  const g = artifact.hosts;
  pulse(
    consent ? 'pass' : 'note',
    'doctor',
    consent
      ? `host smoke complete → ${artifactFile}`
      : 'no live-run consent — LLM surfaces recorded not-run (set CLAD_HOST_SMOKE=1 to probe)',
  );
  process.stdout.write(
    `  claude: ${g.claude.grade}   gemini: ${g.gemini.grade}   antigravity: ${g.antigravity.grade}   ` +
      `codex: ${g.codex.grade}   cursor: ${g.cursor.grade}\n`,
  );
  process.stdout.write(`  artifact: ${artifactFile}\n`);
  process.stdout.write(`  matrix:   ${matrixFile}\n`);
  process.exit(0);
}
