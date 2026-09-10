// Cladding · scripts/ab-abc/score.ts — deterministic scorer for one A/B/C cell
//
// Reads only what a finished cell left behind: the host's stream-json events,
// the measurement pass the driver ran in the arm's own fixture afterwards, the
// harness event log, the workspace files, and git. The session transcript's
// prose is never read or judged — a run's own account of itself is not evidence.
//
// Four groups of measures, plus the extras that explain them:
//   A product — code quality        (src/**)
//   B product — test quality        (tests/**, JUnit, coverage, hidden oracle)
//   C development time              (host durations, wall clock, turn ordinals)
//   D tokens                        (the host's usage block, plus static bytes)
//   E friction, gates, spec artifacts
//
// Two axes are PRE-REGISTERED AS REPORTED-ONLY and never feed the release
// verdict: the hidden oracle's pass rate and the code-quality group. Four prior
// campaigns found correctness orthogonal to the harness; this one does not
// re-litigate that, it just records what happened.
//
// Usage: npx tsx scripts/ab-abc/score.ts <artifact-dir>
//        → writes <artifact-dir>/score.json and prints it.

import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';

/** One line of `.cladding/events.log.jsonl`. */
interface HarnessEvent {
  readonly type: string;
  readonly timestamp?: string;
  readonly payload?: Record<string, unknown>;
}

/** The subset of the host's stream-json `result` event this campaign scores. */
interface HostResult {
  readonly total_cost_usd?: number;
  readonly num_turns?: number;
  readonly duration_ms?: number;
  readonly duration_api_ms?: number;
  readonly is_error?: boolean;
  readonly subtype?: string;
  readonly usage?: Record<string, unknown>;
  readonly modelUsage?: Record<string, Record<string, unknown>>;
  readonly permission_denials?: readonly unknown[];
}

/** Written by make-cell.sh; identifies the arm and its baseline. */
interface CellMeta {
  readonly arm: 'A' | 'B' | 'C';
  readonly cell: string;
  readonly workspace: string;
  readonly enginePath: string;
  readonly engineVersion: string;
  readonly prefix: string;
  readonly task: string;
  readonly baselineCommit: string;
  readonly startedAt: string | null;
}

const readText = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);

const readExit = (p: string): number | null => {
  const raw = readText(p);
  if (raw === null) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isNaN(n) ? null : n;
};

const readJson = <T>(p: string): T | null => {
  const raw = readText(p);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

function readJsonl(p: string): readonly Record<string, unknown>[] {
  const raw = readText(p);
  if (raw === null) return [];
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      out.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      continue;
    }
  }
  return out;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', 'coverage', 'dist', '.cladding']);

function walkFiles(root: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = join(dir, name);
      let s;
      try {
        s = statSync(abs);
      } catch {
        continue;
      }
      if (s.isDirectory()) queue.push(abs);
      else if (s.isFile() && keep(name)) found.push(abs);
    }
  }
  return found.sort();
}

/** `[covers:F-…/AC-…]` at the head of a test title (the 0.2 binding). */
const COVERS_TOKEN_RE = /['"`]\s*\[covers:F-[0-9a-f]{6,8}\/AC-[0-9a-f]{6,8}\]/;

/** Rough tokens — the same 4-bytes-per-token estimate the repo's bench uses. */
const approxTokens = (text: string): number => Math.ceil(text.length / 4);

/** The model every cell is asked to run; anything else is the host's own work. */
const PRIMARY_MODEL = process.env.ABC_MODEL ?? 'claude-opus-5';

/**
 * Splits a source file into code lines and comment lines. Deliberately simple
 * and stated rather than clever: a line inside a block comment counts as a
 * comment line, a line whose first non-space characters are `//` counts as a
 * comment line, everything else with content counts as a code line. Trailing
 * comments on a code line count as code — so `comment_density` never inflates
 * itself on `const x = 1; // why`.
 */
function classifyLines(source: string): {code: number; comment: number; blank: number; jsdocBlocks: number} {
  let code = 0;
  let comment = 0;
  let blank = 0;
  let inBlock = false;
  let jsdocBlocks = 0;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (inBlock) {
      comment++;
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line === '') {
      blank++;
      continue;
    }
    if (line.startsWith('//')) {
      comment++;
      continue;
    }
    if (line.startsWith('/*')) {
      comment++;
      if (line.startsWith('/**')) jsdocBlocks++;
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    code++;
  }
  return {code, comment, blank, jsdocBlocks};
}

/**
 * Cyclomatic complexity per function, counted from decision points.
 *
 * WHY NOT ESLINT: the `complexity` rule needs a TypeScript parser, and the
 * fixture deliberately ships a bare ESLint config so that `npm run lint` means
 * the same trivial thing in all three arms. Adding a parser to measure the arms
 * would change what the arms were asked to do. So the count here is stated
 * outright instead: one per function, plus one for each `if`, `for`, `while`,
 * `case`, `catch`, `&&`, `||`, `??` and `?:` inside it. Function bodies are
 * found by brace matching from a `function`/arrow/method header. It is a coarse
 * measure used only to compare three implementations of one small module — it is
 * not a lint rule and is never a pass/fail.
 */
function complexities(source: string): number[] {
  const headerRe = /(?:function\s+\w*\s*\([^)]*\)|=>\s*\{|\w+\s*\([^)]*\)\s*\{)/g;
  const decisionRe = /\b(if|for|while|case|catch)\b|&&|\|\||\?\?|\?/g;
  const out: number[] = [];
  for (const match of source.matchAll(headerRe)) {
    const braceStart = source.indexOf('{', match.index ?? 0);
    if (braceStart === -1) continue;
    let depth = 0;
    let end = braceStart;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = source.slice(braceStart, end + 1);
    out.push(1 + count(body, decisionRe));
  }
  return out;
}

/** A shard's id, status, criteria count and binding, read without a YAML dep. */
function readShard(path: string): {
  readonly id: string;
  readonly done: boolean;
  readonly hasTestRefs: boolean;
  readonly criteria: number;
  readonly hasStatement: boolean;
  readonly hasEarsField: boolean;
} {
  const raw = readFileSync(path, 'utf8');
  return {
    id: raw.match(/^\s*id:\s*(F-[0-9a-zA-Z-]+)/m)?.[1] ?? path,
    done: /^\s*status:\s*["']?done["']?\s*$/m.test(raw),
    hasTestRefs: /test_refs:\s*\n(\s*#[^\n]*\n)*\s*-\s+\S/.test(raw) || /test_refs:\s*\[\s*\S/.test(raw),
    criteria: count(raw, /^\s*-\s+id:\s*AC-/gm),
    hasStatement: /^\s*statement:\s*\S/m.test(raw),
    hasEarsField: /^\s*ears:\s*\S/m.test(raw),
  };
}

/** Counts `<testcase>` elements in the JUnit report the measurement pass wrote. */
const junitTestCount = (xml: string | null): number | null => (xml === null ? null : count(xml, /<testcase\b/g));

export interface CellScore {
  readonly arm: string;
  readonly cell: string;
  readonly task: string;
  readonly engineVersion: string;
  readonly enginePath: string;
  readonly outcome: {
    readonly engaged: boolean;
    readonly completedHonest: boolean;
    readonly handFlip: boolean;
    readonly featuresCreated: readonly string[];
    readonly doneKept: readonly string[];
    readonly shardsDone: readonly string[];
    readonly bindingMode: 'test_refs' | 'covers-token' | 'none' | 'n/a';
    readonly judgeExit: number | null;
    readonly judgeFailedStages: readonly string[];
    readonly judgeFindings: Record<string, number>;
    readonly judgeAchievedLevel: string | null;
  };
  /** A · code quality — reported only, never a release verdict. */
  readonly code: {
    readonly locSrc: number;
    readonly srcFiles: number;
    readonly lintErrors: number | null;
    readonly lintWarnings: number | null;
    readonly tscClean: boolean | null;
    readonly complexityMax: number | null;
    readonly complexityMean: number | null;
    readonly anyCount: number;
    readonly apiConformance: {
      readonly slugifyExported: boolean;
      readonly signatureMatches: boolean;
      readonly emptySlugErrorDefined: boolean;
      readonly extendsError: boolean;
    };
    readonly errorClassNamed: boolean;
    readonly commentDensity: number | null;
    readonly commentLines: number;
    readonly jsdocBlocks: number;
    readonly headerCommentFiles: number;
    readonly filesOutsideScope: number;
  };
  /** B · test quality — the oracle line is reported only. */
  readonly tests: {
    readonly testCount: number | null;
    readonly assertionCount: number;
    readonly acTitled: readonly string[];
    readonly negativeTestPresent: boolean;
    readonly skipOrOnly: number;
    readonly coverageLinesPct: number | null;
    readonly blindOracle: {readonly passed: number | null; readonly total: number | null; readonly pct: number | null};
  };
  /** C · development time. */
  readonly time: {
    readonly durationMs: number | null;
    readonly durationApiMs: number | null;
    readonly wallMs: number | null;
    readonly numTurns: number | null;
    readonly timeToFirstEditMs: number | null;
    readonly firstGateToolOrdinal: number | null;
    readonly firstGreenGateOrdinal: number | null;
  };
  /** D · tokens. */
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreation: number;
    readonly thinking: number;
    readonly total: number;
    readonly cacheReadRatio: number | null;
    readonly totalCostUsd: number | null;
    readonly costBasis: string;
    readonly modelUsage: Record<string, {readonly outputTokens: number; readonly costUSD: number}>;
    readonly primaryModel: string | null;
    readonly secondaryModelCostUsd: number;
    readonly secondaryModelCostShare: number;
    readonly staticInstructionTokens: number;
  };
  /** E · friction, gates, spec artifacts. */
  readonly extras: {
    readonly toolCallsTotal: number;
    readonly toolCallsMcp: number;
    readonly toolErrors: number;
    readonly permissionDenials: number;
    readonly deniedTools: readonly string[];
    readonly toolUse: Record<string, number>;
    readonly gateRuns: number;
    readonly gateRedThenGreen: boolean;
    readonly gitCommits: number;
    readonly gitCommitMessages: readonly string[];
    readonly worktreeCleanAtEnd: boolean | null;
    readonly harnessStateChanged: boolean;
    readonly specArtifacts: {
      readonly shards: number;
      readonly criteria: number;
      readonly withStatement: number;
      readonly withEarsField: number;
      readonly withTestRefs: number;
    };
    readonly scorerReproducible: boolean | null;
  };
  /** The pre-registered stop signals, evaluated per cell (see the case doc). */
  readonly signals: {
    readonly honestRedLoop: boolean;
    readonly handFlip: boolean;
    readonly budgetCapped: boolean;
    readonly leadingCoversTokens: number;
  };
  readonly disqualifiers: readonly string[];
}

export function scoreCell(artifactDir: string): CellScore {
  const meta = readJson<CellMeta>(join(artifactDir, 'cell.json'));
  if (meta === null) throw new Error(`${artifactDir}/cell.json is missing — the cell never started`);
  const ws = meta.workspace;

  // ── host stream ─────────────────────────────────────────────────────────
  const stream = readJsonl(join(artifactDir, 'run.jsonl'));
  const result = (stream.find((e) => e.type === 'result') ?? null) as HostResult | null;

  const toolUse: Record<string, number> = {};
  let toolErrors = 0;
  let toolCallsTotal = 0;
  let toolCallsMcp = 0;
  let firstEditAt: number | null = null;
  let firstGateToolOrdinal: number | null = null;
  const engineReachesInArmA: string[] = [];

  const startedAt = meta.startedAt === null ? null : Date.parse(meta.startedAt);

  for (const event of stream) {
    const message = event.message as {content?: unknown} | undefined;
    const at = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : null;
    for (const block of (Array.isArray(message?.content) ? message!.content : []) as Array<Record<string, unknown>>) {
      if (block.type === 'tool_result' && block.is_error === true) toolErrors++;
      if (block.type !== 'tool_use' || typeof block.name !== 'string') continue;

      const name = block.name;
      toolUse[name] = (toolUse[name] ?? 0) + 1;
      toolCallsTotal++;
      if (name.startsWith('mcp__')) toolCallsMcp++;

      if (firstEditAt === null && ['Write', 'Edit', 'MultiEdit'].includes(name) && at !== null) firstEditAt = at;

      const command = (block.input as {command?: unknown} | undefined)?.command;
      const commandText = typeof command === 'string' ? command : '';
      const isGateCall = /clad_run_gate|clad_verdict|clad_check/.test(name) || /\bclad\s+(check|done)\b/.test(commandText);
      if (isGateCall && firstGateToolOrdinal === null) firstGateToolOrdinal = toolCallsTotal;

      if (meta.arm === 'A' && /\bclad\b|npx\s+cladding|cladding@/.test(commandText)) {
        engineReachesInArmA.push(commandText.slice(0, 80));
      }
    }
  }

  const usage = (result?.usage ?? {}) as Record<string, unknown>;
  const thinking = num((usage.output_tokens_details as Record<string, unknown> | undefined)?.thinking_tokens);
  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  const cacheCreation = num(usage.cache_creation_input_tokens);
  const totalTokens = inputTokens + outputTokens + cacheRead + cacheCreation;

  const modelUsage: Record<string, {outputTokens: number; costUSD: number}> = {};
  for (const [model, entry] of Object.entries(result?.modelUsage ?? {})) {
    modelUsage[model] = {outputTokens: num(entry.outputTokens), costUSD: num(entry.costUSD)};
  }

  // The static instruction bytes each arm injects before any work happens.
  const staticSources = [
    readText(join(artifactDir, 'prompt.txt')) ?? '',
    readText(join(ws, 'AGENTS.md')) ?? '',
    readText(join(ws, 'CLAUDE.md')) ?? '',
  ];
  const staticInstructionTokens = staticSources.reduce((sum, text) => sum + approxTokens(text), 0);

  // ── harness events ──────────────────────────────────────────────────────
  const events = readJsonl(join(ws, '.cladding', 'events.log.jsonl')) as unknown as HarnessEvent[];
  const featuresCreated: string[] = [];
  const doneKept: string[] = [];
  let gateRuns = 0;
  let sawRedGate = false;
  let gateRedThenGreen = false;
  let firstGreenGateOrdinal: number | null = null;
  for (const event of events) {
    const feature = typeof event.payload?.feature === 'string' ? event.payload.feature : null;
    if (event.type === 'feature_created' && feature !== null) featuresCreated.push(feature);
    if (event.type === 'gate_run') {
      gateRuns++;
      const failed = event.payload?.anyFailed === true;
      if (failed) sawRedGate = true;
      else {
        if (firstGreenGateOrdinal === null) firstGreenGateOrdinal = gateRuns;
        if (sawRedGate) gateRedThenGreen = true;
      }
    }
    if (event.type === 'done_attempted' && event.payload?.kept === true && feature !== null) doneKept.push(feature);
  }

  // ── workspace: source, tests, spec ──────────────────────────────────────
  const srcFiles = walkFiles(join(ws, 'src'), (n) => /\.tsx?$/.test(n));
  const srcSources = srcFiles.map((f) => readFileSync(f, 'utf8'));
  const srcAll = srcSources.join('\n');

  let locSrc = 0;
  let commentLines = 0;
  let jsdocBlocks = 0;
  let headerCommentFiles = 0;
  const allComplexities: number[] = [];
  for (const source of srcSources) {
    const lines = classifyLines(source);
    locSrc += lines.code;
    commentLines += lines.comment;
    jsdocBlocks += lines.jsdocBlocks;
    if (source.trimStart().startsWith('//') || source.trimStart().startsWith('/*')) headerCommentFiles++;
    allComplexities.push(...complexities(source));
  }

  const testFiles = walkFiles(join(ws, 'tests'), (n) => /\.test\.tsx?$/.test(n));
  const testSources = testFiles.map((f) => readFileSync(f, 'utf8'));
  const testsAll = testSources.join('\n');
  // Only lines that open a test case count as titles — the brief asked for the
  // criterion in the TITLE, and a comment mentioning AC-1 is not that.
  const titleLines = testsAll.split('\n').filter((line) => /\b(it|test)\s*\(\s*['"`]/.test(line));
  for (const source of testSources) {
    if (source.trimStart().startsWith('//') || source.trimStart().startsWith('/*')) headerCommentFiles++;
  }

  const shardFiles = walkFiles(join(ws, 'spec', 'features'), (n) => n.endsWith('.yaml'));
  const shards = shardFiles.map(readShard);
  const shardsDone = shards.filter((s) => s.done).map((s) => s.id);

  const anyCoversToken = testSources.some((src) => src.split('\n').some((line) => COVERS_TOKEN_RE.test(line)));
  const anyTestRefs = shards.some((s) => s.hasTestRefs);
  const bindingMode: CellScore['outcome']['bindingMode'] =
    meta.arm === 'A' ? 'n/a' : anyCoversToken ? 'covers-token' : anyTestRefs ? 'test_refs' : 'none';

  // ── measurement pass artifacts ──────────────────────────────────────────
  const eslintReport = readJson<Array<{errorCount?: number; warningCount?: number}>>(join(artifactDir, 'eslint.json'));
  const lintErrors = eslintReport === null ? null : eslintReport.reduce((n, f) => n + num(f.errorCount), 0);
  const lintWarnings = eslintReport === null ? null : eslintReport.reduce((n, f) => n + num(f.warningCount), 0);

  const typecheckExit = readExit(join(artifactDir, 'typecheck.exit'));
  const coverageSummary = readJson<{total?: {lines?: {pct?: number}}}>(join(artifactDir, 'coverage-summary.json'));
  const testCount = junitTestCount(readText(join(artifactDir, 'junit.xml')));

  const oracleReport = readJson<{numPassedTests?: number; numTotalTests?: number}>(join(artifactDir, 'oracle.json'));
  const oraclePassed = oracleReport === null ? null : num(oracleReport.numPassedTests);
  const oracleTotal = oracleReport === null ? null : num(oracleReport.numTotalTests);

  // ── judge ───────────────────────────────────────────────────────────────
  const judgeExit = readExit(join(artifactDir, 'judge-gate.exit'));
  const judge = readJson<{
    achieved_assurance_level?: string;
    stages?: ReadonlyArray<{
      stage?: string;
      label?: string;
      status?: string;
      findings?: ReadonlyArray<{detector?: string; severity?: string}>;
    }>;
  }>(join(artifactDir, 'judge-gate.json'));
  const judgeFailedStages = (judge?.stages ?? []).filter((s) => s.status === 'fail').map((s) => s.label ?? s.stage ?? '?');
  const judgeFindings: Record<string, number> = {};
  for (const stage of judge?.stages ?? []) {
    for (const finding of stage.findings ?? []) {
      const key = `${finding.detector ?? 'unnamed'}:${finding.severity ?? 'unknown'}`;
      judgeFindings[key] = (judgeFindings[key] ?? 0) + 1;
    }
  }

  // ── git ─────────────────────────────────────────────────────────────────
  const commitLines = (readText(join(artifactDir, 'agent-commits.txt')) ?? '').split('\n').filter((l) => l.trim() !== '');
  const gitStatus = readText(join(artifactDir, 'git-status.txt'));
  const changedPaths = (gitStatus ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => l.slice(3).trim());
  // `.cladding/` is harness state, not the agent's product: the event log moves
  // whenever the engine runs, and arm A's own test run creates the report file
  // there. Counting it as "work outside scope" or as a dirty tree would make
  // both measures fire on every cell for reasons no agent chose.
  const productPaths = changedPaths.filter((p) => !p.startsWith('.cladding/') && !p.startsWith('coverage/'));
  const filesOutsideScope = productPaths.filter((p) => !p.startsWith('src/') && !p.startsWith('tests/')).length;
  const harnessStateChanged = changedPaths.some((p) => p.startsWith('.cladding/'));

  // ── the campaign's own outcome measures ─────────────────────────────────
  const engaged = meta.arm === 'A' ? false : featuresCreated.length > 0;
  const completedHonest =
    meta.arm === 'A'
      ? readExit(join(artifactDir, 'npm-test.exit')) === 0 && typecheckExit === 0
      : doneKept.length > 0 && shardsDone.length > 0 && judgeExit === 0;
  const handFlip = shardsDone.length > 0 && doneKept.length === 0;

  // ── disqualifiers ───────────────────────────────────────────────────────
  // Two rules were deliberately relaxed after the reference host run showed
  // they would disqualify every cell for reasons unrelated to the engine.
  //
  //  * A second model appearing in `modelUsage` is the host's own auxiliary
  //    work, not the arm's. It disqualifies only when it carries more than a
  //    tenth of the cost — at which point the cell is no longer a measurement
  //    of the primary model. Otherwise it is reported as a cost split.
  //  * An ordinary permission denial is friction, not contamination: it is
  //    counted and the denied tools are named. A denial of a *cladding* tool is
  //    different — the arm was prevented from using the thing under test — and
  //    that does disqualify.
  const disqualifiers: string[] = [];
  const denials = result?.permission_denials ?? [];
  const deniedToolNames = denials
    .map((d) => (typeof d === 'object' && d !== null ? String((d as {tool_name?: unknown}).tool_name ?? '') : String(d)))
    .filter((n) => n !== '');
  const deniedCladdingTools = deniedToolNames.filter((n) => n.includes('cladding') || n.startsWith('mcp__'));
  if (deniedCladdingTools.length > 0) {
    disqualifiers.push(`a cladding tool call was denied: ${[...new Set(deniedCladdingTools)].join(', ')}`);
  }

  const modelKeys = Object.keys(modelUsage);
  const primaryModel = PRIMARY_MODEL in modelUsage ? PRIMARY_MODEL : (modelKeys[0] ?? null);
  const secondaryModelCostUsd = Number(
    modelKeys
      .filter((k) => k !== primaryModel)
      .reduce((sum, k) => sum + modelUsage[k].costUSD, 0)
      .toFixed(6),
  );
  const totalModelCost = modelKeys.reduce((sum, k) => sum + modelUsage[k].costUSD, 0);
  const secondaryModelCostShare = totalModelCost === 0 ? 0 : Number((secondaryModelCostUsd / totalModelCost).toFixed(3));
  if (secondaryModelCostShare > 0.1) {
    disqualifiers.push(
      `models other than ${primaryModel ?? 'the primary'} carried ${(secondaryModelCostShare * 100).toFixed(1)}% of the cost`,
    );
  }
  if (result === null) disqualifiers.push('no result event — the host never finished');
  if (result?.is_error === true) disqualifiers.push(`is_error subtype=${result.subtype ?? 'unknown'}`);
  if (result?.subtype !== undefined && result.subtype !== 'success') disqualifiers.push(`subtype=${result.subtype}`);

  const stubLog = readText(join(artifactDir, 'stub-calls.log'));
  if (meta.arm === 'A' && stubLog !== null && stubLog.trim() !== '') {
    disqualifiers.push(`arm A contamination — the clad stub was called ${stubLog.trim().split('\n').length}×`);
  }
  for (const reach of engineReachesInArmA) {
    disqualifiers.push(`arm A contamination — Bash reached for the engine: ${reach}`);
  }
  if (meta.arm !== 'A' && !meta.enginePath.startsWith(meta.prefix)) {
    disqualifiers.push(`engine path ${meta.enginePath} is outside the arm prefix ${meta.prefix}`);
  }

  const mean = (values: readonly number[]): number | null =>
    values.length === 0 ? null : Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));

  return {
    arm: meta.arm,
    cell: meta.cell,
    task: meta.task,
    engineVersion: meta.engineVersion,
    enginePath: meta.enginePath,
    outcome: {
      engaged,
      completedHonest,
      handFlip,
      featuresCreated,
      doneKept,
      shardsDone,
      bindingMode,
      judgeExit,
      judgeFailedStages,
      judgeFindings,
      judgeAchievedLevel: judge?.achieved_assurance_level ?? null,
    },
    code: {
      locSrc,
      srcFiles: srcFiles.length,
      lintErrors,
      lintWarnings,
      tscClean: typecheckExit === null ? null : typecheckExit === 0,
      complexityMax: allComplexities.length === 0 ? null : Math.max(...allComplexities),
      complexityMean: mean(allComplexities),
      anyCount: count(srcAll, /:\s*any\b|\bas\s+any\b|<any>/g),
      apiConformance: {
        slugifyExported: /export\s+(?:const|function|async\s+function)\s+slugify\b/.test(srcAll) || /export\s*\{[^}]*\bslugify\b/.test(srcAll),
        signatureMatches: /slugify\s*(?:=\s*)?\(\s*\w+\s*:\s*string\s*\)\s*(?::\s*string)?/.test(srcAll),
        emptySlugErrorDefined: /\bEmptySlugError\b/.test(srcAll),
        extendsError: /class\s+EmptySlugError\s+extends\s+\w*Error\b/.test(srcAll),
      },
      errorClassNamed: /\bname\s*=\s*['"`]EmptySlugError['"`]/.test(srcAll),
      commentDensity: locSrc === 0 ? null : Number((commentLines / locSrc).toFixed(3)),
      commentLines,
      jsdocBlocks,
      headerCommentFiles,
      filesOutsideScope,
    },
    tests: {
      testCount,
      assertionCount: count(testsAll, /\bexpect\s*\(/g),
      acTitled: ['AC-1', 'AC-2', 'AC-3'].filter((label) => titleLines.some((line) => line.includes(label))),
      negativeTestPresent: /toThrow|rejects|EmptySlugError/.test(testsAll),
      skipOrOnly: count(testsAll, /\.(skip|only|todo)\b/g),
      coverageLinesPct: coverageSummary?.total?.lines?.pct ?? null,
      blindOracle: {
        passed: oraclePassed,
        total: oracleTotal,
        pct: oraclePassed === null || oracleTotal === null || oracleTotal === 0 ? null : Number(((oraclePassed / oracleTotal) * 100).toFixed(1)),
      },
    },
    time: {
      durationMs: typeof result?.duration_ms === 'number' ? result.duration_ms : null,
      durationApiMs: typeof result?.duration_api_ms === 'number' ? result.duration_api_ms : null,
      wallMs: readExit(join(artifactDir, 'wall-ms.txt')),
      numTurns: typeof result?.num_turns === 'number' ? result.num_turns : null,
      timeToFirstEditMs: firstEditAt === null || startedAt === null ? null : firstEditAt - startedAt,
      firstGateToolOrdinal,
      firstGreenGateOrdinal,
    },
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cacheRead,
      cacheCreation,
      thinking,
      total: totalTokens,
      cacheReadRatio: totalTokens === 0 ? null : Number((cacheRead / totalTokens).toFixed(3)),
      totalCostUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
      costBasis: 'OAuth-session list-price estimate reported by the host — not an amount billed',
      modelUsage,
      primaryModel,
      secondaryModelCostUsd,
      secondaryModelCostShare,
      staticInstructionTokens,
    },
    extras: {
      toolCallsTotal,
      toolCallsMcp,
      toolErrors,
      permissionDenials: denials.length,
      deniedTools: [...new Set(deniedToolNames)].sort(),
      toolUse,
      gateRuns,
      gateRedThenGreen,
      gitCommits: commitLines.length,
      gitCommitMessages: commitLines.map((l) => l.split('\t')[1] ?? l),
      worktreeCleanAtEnd: gitStatus === null ? null : productPaths.length === 0,
      harnessStateChanged,
      specArtifacts: {
        shards: shards.length,
        criteria: shards.reduce((n, s) => n + s.criteria, 0),
        withStatement: shards.filter((s) => s.hasStatement).length,
        withEarsField: shards.filter((s) => s.hasEarsField).length,
        withTestRefs: shards.filter((s) => s.hasTestRefs).length,
      },
      scorerReproducible: (() => {
        const raw = readText(join(artifactDir, 'scorer-reproducible.txt'));
        return raw === null ? null : raw.trim() === 'true';
      })(),
    },
    signals: {
      // R2 — a run that kept gating and never kept a completion.
      honestRedLoop: gateRuns >= 8 && doneKept.length === 0,
      handFlip,
      budgetCapped: result?.subtype !== undefined && /budget/i.test(result.subtype),
      // R6 — the guidance gap D0 fixed: no test title leads with a covers token.
      leadingCoversTokens: titleLines.filter((line) => COVERS_TOKEN_RE.test(line)).length,
    },
    disqualifiers,
  };
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('score.ts');
if (invokedDirectly) {
  const artifactDir = process.argv[2];
  if (artifactDir === undefined) throw new Error('usage: npx tsx scripts/ab-abc/score.ts <artifact-dir>');
  const score = scoreCell(artifactDir);
  const rendered = `${JSON.stringify(score, null, 2)}\n`;
  writeFileSync(join(artifactDir, 'score.json'), rendered);
  process.stdout.write(rendered);
}
