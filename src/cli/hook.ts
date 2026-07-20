// Cladding · `clad hook <event>` — host hook protocol adapter (F-1d23a6)
//
// Claude Code lifecycle hooks invoke this verb with the event payload on
// stdin and read the protocol response from stdout. The contract:
//
//   - stdin may be empty or malformed JSON → treated as `{}`
//   - stdout is the ONLY protocol surface: plain text becomes injected
//     context (SessionStart / UserPromptSubmit / PostToolUse), and a
//     `{"decision":"block","reason":…}` JSON line blocks (PreToolUse / Stop)
//   - ALWAYS exit 0 — a crashing hook must never brick the host session,
//     so every handler is wrapped and an internal error prints nothing
//
// This file moves cladding's engagement layer from prose (CLAUDE.md asking
// the model to behave) to structure (the host mechanically injecting the
// spec map and mechanically blocking hand-flipped `status: done`).
//
// HONEST LIMIT: PreToolUse only sees Edit/Write/MultiEdit tool calls — a
// YAML edit made THROUGH Bash (sed, heredoc, git apply) bypasses the block
// lane entirely. The Stop hook's deterministic trio is the second lane that
// catches the result after the fact (annotation-free done trips MISSING_TESTS
// etc.). Blocking is lane one, post-hoc detection is lane two; neither alone.
// The CARD half of that Bash hole is closed since F-e7d59c88: PostToolUse also
// matches Bash and attributes shell-made source mutations via git delta —
// advisory context only, NEVER a block decision from shell parsing.
//
// @see plugins/claude-code/hooks/hooks.json — the shipped wiring (AC-03da31).
// @see spec/features/host-hooks-1d23a6.yaml — the contract.

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import process from 'node:process';

import {parse as parseYaml} from 'yaml';

import {latestEventOfType, recordEvent, type ImpactSkipReason} from '../events/log.js';
import type {Intent} from '../router/intent.js';
import {suggestIntent} from '../router/intent.js';
import {runArch} from '../stages/arch.js';
import {clearDetectorResultCache, primeDetectorResultCache} from '../stages/detector-result-cache.js';
import {runDrift} from '../stages/drift.js';
import {runSecret} from '../stages/secret.js';
import {buildImpactSlice, type ImpactSlice} from '../optimizer/reverse-slice.js';
import {buildWorkingSet, type WorkingSet} from '../optimizer/working-set.js';
import {dependSegment, formatWorkingSetCard, formatPushOneLiner, guardSegment, UNLEDGERED_NOTE} from '../optimizer/push-card.js';
import {estTokens} from '../optimizer/code-excerpt.js';
import {loadSpec} from '../spec/load.js';
import {WATCHED_EXTENSIONS} from '../stages/toolchain/language-config.js';
import {driftNudge, plainFinding, plainLead, stopBlockMessage} from '../ui/softShell.js';

// --- shared helpers ----------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const WRITE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit']);

// --- SessionStart — context card ---------------------------------------

interface IndexDoc {
  readonly features?: Record<string, {readonly slug?: unknown; readonly status?: unknown} | null>;
}

interface SpecDoc {
  readonly inventory?: {readonly features?: unknown; readonly scenarios?: unknown};
  readonly features?: readonly {readonly id?: unknown; readonly slug?: unknown; readonly status?: unknown}[];
  readonly scenarios?: readonly unknown[];
  readonly project?: unknown; // project.ai_hints.preferred_patterns → prefer lines (F-fb9b48a5)
}

// Human-first policy line (F-f46d5c61, AC-2c63b999): no MCP tool names, no
// "shards", no "SSoT" acronym. The `policy:` prefix is a structural pin (a
// startsWith check in the session-guidance tests depends on it); the sentence
// after it is plain English the coding agent renders back in the user's language.
const POLICY_LINE =
  "policy: the spec is the source of truth — features are created and completed through cladding's verified flow";

// One-line push of cladding's context-compiler capability (F-fb9b48a5, superseded
// by F-f46d5c61 AC-2c63b999). Adopters do not know the MCP tool names — the B1
// data shows naming them drove zero pulls — so this advertises the CAPABILITY in
// plain English instead. Agent-facing tool names live in the MCP descriptions and
// the injected instruction files. The `context:` prefix is a structural pin.
const CONTEXT_LINE =
  'context: before a non-trivial change, cladding can slice what a feature needs, what depends on it, and which tests guard it — ask for it';

/**
 * Best-effort `prefer:` lines from project.ai_hints.preferred_patterns — the
 * first two entries only, values VERBATIM from spec.yaml, each truncated to 140
 * chars (AC-14f7778c). ai_hints absent or malformed (project/ai_hints not an
 * object, patterns not an array, an entry missing a field) → skipped silently,
 * never a throw (AC-5303e049).
 */
function preferLines(spec: SpecDoc): string[] {
  const ai = asRecord(asRecord(spec.project).ai_hints);
  const patterns = ai.preferred_patterns;
  if (!Array.isArray(patterns)) return [];
  const out: string[] = [];
  for (const p of patterns.slice(0, 2)) {
    const entry = asRecord(p);
    const prefer = asString(entry.prefer);
    const over = asString(entry.over);
    const when = asString(entry.when);
    if (prefer.length === 0 || over.length === 0 || when.length === 0) continue;
    out.push(truncate(`prefer: ${prefer} over ${over} (${when})`, 140));
  }
  return out;
}

/**
 * Renders the SessionStart context card — the spec map injected mechanically
 * instead of relying on the model greping CLAUDE.md. Prints nothing when the
 * project is not under cladding (no spec.yaml).
 */
function renderSessionStartCard(cwd: string): string {
  const specPath = join(cwd, 'spec.yaml');
  if (!existsSync(specPath)) return '';
  let spec: SpecDoc = {};
  let parseFailed = false;
  try {
    spec = (parseYaml(readFileSync(specPath, 'utf8')) as SpecDoc | null) ?? {};
  } catch {
    parseFailed = true; // counts may still resolve via spec/index.yaml (the primary source)
  }

  let total = 0;
  let done = 0;
  const inProgress: {id: string; slug: string}[] = [];
  let counted = false;

  // Primary source: spec/index.yaml — one `F-xxx: {slug, status, modules: N}`
  // line per feature, regenerated by `clad sync` (F-37b4a8).
  const indexPath = join(cwd, 'spec', 'index.yaml');
  if (existsSync(indexPath)) {
    try {
      const idx = (parseYaml(readFileSync(indexPath, 'utf8')) as IndexDoc | null) ?? {};
      for (const [id, row] of Object.entries(asRecord(idx.features))) {
        total++;
        const entry = asRecord(row);
        const status = asString(entry.status);
        if (status === 'done') done++;
        if (status === 'in_progress') inProgress.push({id, slug: asString(entry.slug) || id});
      }
      counted = true;
    } catch {
      /* unreadable index → fall through to spec.yaml */
    }
  }
  // Fallbacks: inline features[] (unsharded spec), then the auto-maintained
  // inventory block (sharded spec whose index has not been generated yet).
  if (!counted && Array.isArray(spec.features)) {
    for (const f of spec.features) {
      total++;
      const entry = asRecord(f);
      const status = asString(entry.status);
      const id = asString(entry.id) || '?';
      if (status === 'done') done++;
      if (status === 'in_progress') inProgress.push({id, slug: asString(entry.slug) || id});
    }
    counted = true;
  }
  if (!counted) {
    const n = Number(spec.inventory?.features);
    total = Number.isFinite(n) ? n : 0;
  }
  const scenariosInventory = Number(spec.inventory?.scenarios);
  const scenarios = Number.isFinite(scenariosInventory)
    ? scenariosInventory
    : Array.isArray(spec.scenarios)
      ? spec.scenarios.length
      : 0;

  // An unparseable master with NO other count source must not render as a
  // verified-empty "0 features" project (F-c6a32fff). Conditional on !counted:
  // sharded projects usually still count fine via spec/index.yaml.
  const lines: string[] = [
    parseFailed && !counted
      ? 'cladding: spec.yaml present but unparseable — counts unavailable (run clad check)'
      : `cladding: ${total} features (${done} done, ${inProgress.length} in progress) · ${scenarios} scenarios`,
  ];
  if (inProgress.length > 0) {
    lines.push(`in progress: ${inProgress.slice(0, 3).map((f) => `${f.id} ${f.slug}`).join(', ')}`);
  }
  const gate = latestEventOfType(cwd, 'gate_run');
  if (gate) {
    const head = asString(gate.payload.head).length > 0 ? asString(gate.payload.head).slice(0, 8) : 'no-git';
    const red = gate.payload.anyFailed === true || (typeof gate.payload.worst === 'number' && gate.payload.worst > 0);
    lines.push(`last gate: ${asString(gate.payload.tier) || '?'} strict=${gate.payload.strict === true} → ${red ? 'RED' : 'GREEN'} @ ${head}`);
  }
  const blockPath = join(cwd, '.cladding', 'stop-block.json');
  if (existsSync(blockPath)) {
    try {
      const sb = JSON.parse(readFileSync(blockPath, 'utf8')) as {count?: unknown; first?: unknown};
      lines.push(`unresolved stop-block: ${Number(sb.count ?? 0)} finding(s) — ${asString(sb.first) || 'unknown'}`);
    } catch {
      /* unreadable block file → omit the resurface line */
    }
  }
  // context → prefer → policy: the guidance tail (F-fb9b48a5). Ordering + the 9-line
  // cap (AC-20893cbc) hold because in-progress is one truncated line, not per-id.
  lines.push(CONTEXT_LINE);
  for (const line of preferLines(spec)) lines.push(line);
  lines.push(POLICY_LINE);
  return lines.join('\n');
}

// --- UserPromptSubmit — one-line routing suggestion ---------------------

// Suggestion hints (F-f46d5c61, AC-2c63b999): no MCP tool names — only CLI
// commands the user could type (`clad check --strict`, `clad done`) — and "shard"
// reworded to "spec entry". Plain English the coding agent relays in the user's tongue.
const INTENT_HINTS: Readonly<Partial<Record<Intent, string>>> = {
  run: 'feature cycle: spec entry → implement → tests → clad done',
  check: 'verify with clad check --strict',
  sync: 'clad sync validates + heals the spec',
  init: 'apply Cladding to this project',
};

// Completion claims were the WEAKEST measured engagement surface (the 0.6.0
// engagement sample failed the entire c-bucket on both arms): "looks done,
// wrap it up" produced no gated `clad done`. A dedicated card beats the
// generic check suggestion here (F-95a096).
const COMPLETION_CLAIM =
  /\b(wrap (it |this )?up|looks? (all )?done|mark (it |this |.{0,24})?done|finish(ed)? (it|this|up)|ship it)\b|마무리|완료 ?처리|끝난 ?것 ?같|완료해/i;

/**
 * Classifies a prompt into the suggestion it would serve (or null for
 * unclassifiable prompts). Returns `kind` alongside the text so the telemetry
 * payload (prompt_suggestion_served.kind) is a byte-exact bijection with what
 * was rendered — the surface and its trace are computed once, together.
 */
function classifyPromptSuggestion(input: unknown): {readonly kind: string; readonly text: string} | null {
  const prompt = asString(asRecord(input).prompt);
  if (prompt.length === 0) return null;
  if (COMPLETION_CLAIM.test(prompt)) {
    return {
      kind: 'completion',
      text:
        'cladding: completion is EARNED, not declared — run `clad done <F-id>`; ' +
        'the strict gate flips it to done only when the checks pass',
    };
  }
  const intent = suggestIntent(prompt);
  const hint = intent ? INTENT_HINTS[intent] : undefined;
  if (!intent || !hint) return null;
  const workLabel = intent === 'init' ? 'project setup' : `${intent} work`;
  return {kind: intent, text: `cladding: this looks like ${workLabel} — ${hint}`};
}

// --- PreToolUse — structural guard on spec edits ------------------------

const FEATURE_SHARD_PATH = /spec[\\/]features[\\/][^\\/]+\.ya?ml$/;
const SEQUENTIAL_SHARD_PATH = /spec[\\/]features[\\/]F-\d+\.ya?ml$/;
const ROOT_SPEC_PATH = /(^|[\\/])spec\.yaml$/;
const DONE_LINE = /^\s*status:\s*done\b/m;
const DONE_LINE_ALL = /^\s*status:\s*done\b/gm;

// Block reasons (F-f46d5c61, AC-2c63b999). These are read by BOTH the user AND the
// agent as denial feedback, so they stay action-guiding — capability phrasing with a
// user-typeable CLI command, no MCP tool name, "spec entry" not "shard". Plain English.
const DONE_BLOCK_REASON =
  'completion is earned — ask to run the completion gate (clad done) instead of writing status: done by hand';
const HASH_ID_REASON =
  'cladding assigns feature ids safely — ask it to create the spec entry instead of hand-writing the file';

function renderBlock(reason: string): string {
  return JSON.stringify({decision: 'block', reason});
}

function introducesDone(oldString: string, newString: string): boolean {
  return DONE_LINE.test(newString) && !DONE_LINE.test(oldString);
}

function countDoneLines(text: string): number {
  return text.match(DONE_LINE_ALL)?.length ?? 0;
}

/**
 * Decides whether a spec edit must be blocked. Two measured bypasses become
 * structurally impossible here (AC-2c2d29): hand-flipping `status: done`
 * (23 observed) and hand-authoring sequential F-NNN shard filenames. Every
 * other spec maintenance edit stays allowed (empty output).
 */
function resolvePreToolUseDecision(input: unknown, cwd: string): string {
  const rec = asRecord(input);
  const tool = asString(rec.tool_name);
  if (!WRITE_TOOLS.has(tool)) return '';
  const toolInput = asRecord(rec.tool_input);
  const filePath = asString(toolInput.file_path);
  if (filePath.length === 0) return '';
  // A Write that CREATES a sequential shard filename bypasses the hash-id
  // model (docs/spec-ids-multi-dev.md). Edits to legacy F-NNN files stay
  // allowed — they are stable historical identifiers, not new authorship.
  if (tool === 'Write' && SEQUENTIAL_SHARD_PATH.test(filePath)) {
    return renderBlock(HASH_ID_REASON);
  }
  if (!FEATURE_SHARD_PATH.test(filePath) && !ROOT_SPEC_PATH.test(filePath)) return '';
  if (tool === 'Edit') {
    return introducesDone(asString(toolInput.old_string), asString(toolInput.new_string))
      ? renderBlock(DONE_BLOCK_REASON)
      : '';
  }
  if (tool === 'MultiEdit') {
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : [];
    for (const e of edits) {
      const edit = asRecord(e);
      if (introducesDone(asString(edit.old_string), asString(edit.new_string))) {
        return renderBlock(DONE_BLOCK_REASON);
      }
    }
    return '';
  }
  // Write — block only when the content carries MORE `status: done` lines
  // than the current on-disk file: a brand-new done, not a faithful rewrite.
  const contentCount = countDoneLines(asString(toolInput.content));
  if (contentCount === 0) return '';
  let diskCount = 0;
  try {
    diskCount = countDoneLines(readFileSync(isAbsolute(filePath) ? filePath : join(cwd, filePath), 'utf8'));
  } catch {
    /* no prior file on disk → every done line in the content is new */
  }
  return contentCount > diskCount ? renderBlock(DONE_BLOCK_REASON) : '';
}

// --- Stop — deterministic trio with fingerprint-keyed demotion ----------

interface StopFailure {
  readonly detector: string;
  readonly path: string;
  readonly message: string;
}

function stopBlockPath(cwd: string): string {
  return join(cwd, '.cladding', 'stop-block.json');
}

/**
 * Runs the cheap deterministic trio (drift strict / arch / secret) silently
 * when the host fires Stop (AC-973837). Fresh failure fingerprints block with
 * the top findings + a `stop_blocked` event; an IDENTICAL fingerprint demotes
 * to allow so an unfixable-in-session failure never traps the user — the
 * SessionStart card resurfaces the persisted stop-block instead.
 */
function runStopGate(input: unknown, cwd: string): string {
  if (asRecord(input).stop_hook_active === true) return '';
  // Not under cladding → not our session to gate (SessionStart parity, F-c6a32fff).
  // Without this, a spec-less cwd (non-cladding repo, or a SUBDIR of a cladding
  // monorepo — the hook cwd is process.cwd(), no upward search) got falsely
  // BLOCKED by ABSENCE_OF_GOVERNANCE and had .cladding/ state written into it.
  if (!existsSync(join(cwd, 'spec.yaml'))) return '';
  const failures: StopFailure[] = [];
  // F-e53596dd — the Stop gate is the drift trio (drift strict / arch / secret)
  // and paid the madge + secretlint double-spawn on EVERY turn. Prime the
  // detector cache so runDrift publishes ARCHITECTURE_VIOLATION + HARDCODED_
  // SECRET for the two adapter stages below; clear in finally (this runs
  // in-process, so a leaked session would poison the next turn's gate).
  primeDetectorResultCache(cwd);
  try {
    try {
      const drift = runDrift({strict: true, cwd});
      for (const f of drift.findings) {
        if (f.severity === 'error' || f.severity === 'warn') {
          failures.push({detector: f.detector, path: f.path ?? '', message: f.message});
        }
      }
    } catch {
      /* a broken stage must never brick the host — treat as no signal */
    }
    for (const [name, run] of [['ARCH', runArch], ['SECRET', runSecret]] as const) {
      try {
        const r = run({cwd});
        if (r.exitCode === 1) {
          const firstLine = (r.stderr ?? '').split('\n').find((l) => l.trim().length > 0);
          failures.push({detector: name, path: 'stage', message: firstLine ?? `${name.toLowerCase()} stage failed`});
        }
      } catch {
        /* same — silent degrade */
      }
    }
  } finally {
    clearDetectorResultCache();
  }
  const blockFile = stopBlockPath(cwd);
  if (failures.length === 0) {
    try {
      rmSync(blockFile, {force: true}); // resolved — clear the persisted block
    } catch {
      /* best-effort cleanup */
    }
    return '';
  }
  // Fingerprint = sha256 over the sorted detector|path set — state-keyed, so
  // the demotion can never be gamed by simply stopping repeatedly on NEW drift
  // (attempt-count demotion was rejected as a vacuous-green vector).
  const fingerprint = createHash('sha256')
    .update(failures.map((f) => `${f.detector}|${f.path}`).sort().join('\n'))
    .digest('hex');
  try {
    const prev = JSON.parse(readFileSync(blockFile, 'utf8')) as {fingerprint?: unknown};
    if (prev.fingerprint === fingerprint) return ''; // identical → demote; the SessionStart card resurfaces it
  } catch {
    /* no prior block recorded */
  }
  try {
    mkdirSync(dirname(blockFile), {recursive: true});
    writeFileSync(
      blockFile,
      `${JSON.stringify({fingerprint, count: failures.length, first: failures[0].detector})}\n`,
      'utf8',
    );
  } catch {
    /* unwritable state dir → still block; demotion just won't persist */
  }
  recordEvent(cwd, 'stop_blocked', {count: failures.length, fingerprint});
  // Plain-first render (F-dd8dc994): a plain English lead per top finding, the
  // machine detail (detector · path) demoted to a parenthetical tail. The host
  // agent renders the user's own language (F-9af291fa). The fingerprint above
  // hashes detector|path — message-free, so this render cannot move it (AC-ad2a34e1).
  const examples = failures
    .slice(0, 2)
    .map((f) => plainFinding(f))
    .join('; ');
  return renderBlock(stopBlockMessage(failures.length, examples));
}

// --- PostToolUse — debounced drift nudge --------------------------------

const DRIFT_DEBOUNCE_MS = 20_000;

// Extension arm derives from the language SSoT (WATCHED_EXTENSIONS in
// stages/toolchain/language-config.ts) so every language cladding claims — incl.
// .tsx/.jsx and the JVM/Ruby/PHP/C#/Elixir surface — fires an impact card outside
// src/, not just the legacy 5-ext set (F-63b989e5). The src/-segment rule is
// UNCHANGED: any path with a src/ segment stays watched regardless of extension.
// Pure string/set membership — synchronous, no fs, no per-call regex rebuild.
function isWatchedSourcePath(filePath: string): boolean {
  if (filePath.length === 0) return false;
  if (/(^|[\\/])src[\\/]/.test(filePath)) return true;
  return WATCHED_EXTENSIONS.has(extname(filePath).toLowerCase());
}

const MIN_EDIT_CHARS = 40; // below this an edit is too trivial to warrant an impact card

/** Approximate changed-char magnitude of an Edit/Write/MultiEdit tool input (tiny-edit guard). */
export function editMagnitude(toolInput: unknown): number {
  const t = asRecord(toolInput);
  if (typeof t.content === 'string') return t.content.length; // Write
  if (Array.isArray(t.edits)) {
    return (t.edits as unknown[]).reduce<number>((n, e) => n + asString(asRecord(e).new_string).length, 0); // MultiEdit
  }
  return asString(t.new_string).length; // Edit
}

/**
 * One-line impact card from a resolved slice — owning feature(s) + how many downstream
 * features could break + how many regression tests to run. '' when the file touches no feature.
 */
export function formatImpactCard(slice: ImpactSlice, filePath: string): string {
  const owners = slice.focus.owners ?? [];
  const primary = slice.focus.id ?? owners[0];
  if (!primary) return '';
  // Feature titles alongside ids (F-f46d5c61, AC-2a7fed0c) when the slice carries
  // one — a feature query does; a module query (the hook's usual case) surfaces
  // only owner ids, so the data-poor fallback stays id-only.
  const label = slice.focus.title ? `${primary} ${slice.focus.title}` : primary;
  const co = owners.length > 1 ? ` (+${owners.length - 1} co-owner${owners.length > 2 ? 's' : ''})` : '';
  // Blank ledger disclosure: empty consequence segments must not read as "verified
  // safe" when NO depends_on edge exists project-wide (strict === 0 — old-shaped
  // slices without a ledger stay unmarked rather than mis-firing). Wording shared
  // with the push card so both surfaces read identically.
  const unledgered = slice.ledger?.depends_on_edges === 0 ? UNLEDGERED_NOTE : '';
  return `cladding impact: ${filePath} → ${label}${co}${dependSegment(slice.impacted.length)}${guardSegment(slice.test_refs.length)}${unledgered}`;
}

// --- impact-card telemetry (F-6ba22c5c) --------------------------------
//
// Observer-only: every path below is wrapped so a telemetry failure leaves the
// hook's stdout byte-identical (AC-e9d041de). recordEvent is already best-effort;
// the sidecar I/O is guarded on top of it.
//
// Each hook invocation is a SEPARATE OS process, so in-memory aggregation across
// events is impossible. The two high-frequency skip reasons (not_write_tool,
// unwatched_path — fired on every Read / non-source edit) are accumulated in a
// tiny fixed-size sidecar counter and flushed as ONE impact_card_skipped event
// per DRIFT_DEBOUNCE_MS window (AC-8fc6bea0), so per-call skip volume cannot
// rotate gate_run history out of the 5MB events.log.

const SKIP_AGG_FILE = 'hook-skip-agg.json';

interface SkipAgg {
  windowStart: number;
  not_write_tool: number;
  unwatched_path: number;
}

function skipAggPath(cwd: string): string {
  return join(cwd, '.cladding', SKIP_AGG_FILE);
}

/** Read the sidecar; corrupt/missing → a fresh window (never throws). */
function readSkipAgg(cwd: string, now: number): SkipAgg {
  try {
    const o = JSON.parse(readFileSync(skipAggPath(cwd), 'utf8')) as Partial<SkipAgg>;
    return {
      windowStart: Number.isFinite(o.windowStart) ? Number(o.windowStart) : now,
      not_write_tool: Number.isFinite(o.not_write_tool) ? Number(o.not_write_tool) : 0,
      unwatched_path: Number.isFinite(o.unwatched_path) ? Number(o.unwatched_path) : 0,
    };
  } catch {
    return {windowStart: now, not_write_tool: 0, unwatched_path: 0};
  }
}

function writeSkipAgg(cwd: string, agg: SkipAgg): void {
  try {
    mkdirSync(dirname(skipAggPath(cwd)), {recursive: true});
    writeFileSync(skipAggPath(cwd), JSON.stringify(agg), 'utf8');
  } catch {
    /* unwritable sidecar → aggregation just won't persist; never a throw */
  }
}

/** Emit the accumulated counts as ONE impact_card_skipped event (if any), and
 * return a fresh window. reason ∈ the closed enum; both counts ride the payload. */
function flushSkipAgg(cwd: string, agg: SkipAgg, now: number): SkipAgg {
  if (agg.not_write_tool > 0 || agg.unwatched_path > 0) {
    recordEvent(cwd, 'impact_card_skipped', {
      reason: agg.not_write_tool >= agg.unwatched_path ? 'not_write_tool' : 'unwatched_path',
      aggregate: true,
      counts: {not_write_tool: agg.not_write_tool, unwatched_path: agg.unwatched_path},
      window_ms: now - agg.windowStart,
    });
  }
  return {windowStart: now, not_write_tool: 0, unwatched_path: 0};
}

/** Increment a high-frequency skip counter; flush the previous window first when it rolled over. */
function aggregateImpactSkip(cwd: string, reason: 'not_write_tool' | 'unwatched_path'): void {
  try {
    const now = Date.now();
    let agg = readSkipAgg(cwd, now);
    if (now - agg.windowStart >= DRIFT_DEBOUNCE_MS) agg = flushSkipAgg(cwd, agg, now);
    agg[reason] += 1;
    writeSkipAgg(cwd, agg);
  } catch {
    /* telemetry is observer-only */
  }
}

/** Flush any pending high-frequency skips — called when a real card fires (the window closed). */
function flushPendingSkipAgg(cwd: string): void {
  try {
    const now = Date.now();
    writeSkipAgg(cwd, flushSkipAgg(cwd, readSkipAgg(cwd, now), now));
  } catch {
    /* observer-only */
  }
}

/** Per-occurrence skip event for a substantive reason (all reasons but the two aggregated). */
function recordImpactSkip(cwd: string, reason: ImpactSkipReason): void {
  recordEvent(cwd, 'impact_card_skipped', {reason});
}

// --- unbound-edit nudge (F-f9891175) -----------------------------------
//
// When watched source edits keep resolving to no owning feature, the feature
// cycle is never TRIGGERED — cladding otherwise stays silent (owner_miss skips).
// This counts owner_miss edits in a rolling window and, once past a small
// threshold, returns ONE advisory nudge line for the PostToolUse card, fired
// once per window (AC-5d379d4e). Same sidecar discipline as SkipAgg; every path
// is wrapped so a failure returns '' and stdout stays byte-identical (AC-228fdc15).

const UNBOUND_AGG_FILE = 'hook-unbound-agg.json';
const UNBOUND_NUDGE_THRESHOLD = 3;
const UNBOUND_WINDOW_MS = 10 * 60_000; // rolling 10-minute accumulation window

interface UnboundAgg {
  windowStart: number;
  count: number;
  nudged: boolean;
}

function unboundAggPath(cwd: string): string {
  return join(cwd, '.cladding', UNBOUND_AGG_FILE);
}

/** Read the sidecar; corrupt/missing → a fresh window (never throws). */
function readUnboundAgg(cwd: string, now: number): UnboundAgg {
  try {
    const o = JSON.parse(readFileSync(unboundAggPath(cwd), 'utf8')) as Partial<UnboundAgg>;
    return {
      windowStart: Number.isFinite(o.windowStart) ? Number(o.windowStart) : now,
      count: Number.isFinite(o.count) ? Number(o.count) : 0,
      nudged: o.nudged === true,
    };
  } catch {
    return {windowStart: now, count: 0, nudged: false};
  }
}

function writeUnboundAgg(cwd: string, agg: UnboundAgg): void {
  try {
    mkdirSync(dirname(unboundAggPath(cwd)), {recursive: true});
    writeFileSync(unboundAggPath(cwd), JSON.stringify(agg), 'utf8');
  } catch {
    /* unwritable sidecar → nudge just won't persist; never a throw */
  }
}

/**
 * Counts one owner_miss (unbound) source edit and, when the rolling-window count
 * first crosses the threshold, returns ONE advisory nudge line — otherwise ''.
 * Observer-only: any failure returns '' so the caller's stdout is byte-identical
 * to the output produced without this feature (AC-228fdc15).
 */
function unboundEditNudge(cwd: string): string {
  try {
    const now = Date.now();
    let agg = readUnboundAgg(cwd, now);
    if (now - agg.windowStart >= UNBOUND_WINDOW_MS) agg = {windowStart: now, count: 0, nudged: false};
    agg.count += 1;
    let line = '';
    if (agg.count >= UNBOUND_NUDGE_THRESHOLD && !agg.nudged) {
      agg.nudged = true;
      line =
        `cladding: ${agg.count} recent source edits aren't tracked by any feature — ` +
        "start a feature for this work (or add these files to one you've already started) so the spec-first cycle covers them.";
    }
    writeUnboundAgg(cwd, agg);
    return line;
  } catch {
    return '';
  }
}

/** Records one impact_card_fired + closes the aggregate window. `tier` is optional so the
 * shipped fallback path (AC-38141a9e) emits the byte-identical pre-tier payload. */
function recordFiredEvent(cwd: string, payload: Record<string, unknown>): void {
  recordEvent(cwd, 'impact_card_fired', payload);
  flushPendingSkipAgg(cwd); // a fired card closes the window → flush accumulated skips
}

/** Fired-card event for the SHIPPED slice path; payload mirrors formatImpactCard's inputs
 * (AC-373257b2 bijection). Used only by the byte-identical fallback (working set unavailable).
 * `lane` is the additive F-e7d59c88 tag ('bash' on the git-delta lane; absent on native edits). */
function recordImpactFired(cwd: string, file: string, slice: ImpactSlice, lane?: 'bash'): void {
  const owners = slice.focus.owners ?? [];
  recordFiredEvent(cwd, {
    file,
    feature: slice.focus.id ?? owners[0] ?? '',
    impacted: slice.impacted.length,
    tests: slice.test_refs.length,
    unledgered: slice.ledger?.depends_on_edges === 0,
    ...(lane ? {lane} : {}),
  });
}

// --- session push ledger (F-35954d19) ----------------------------------
//
// The Tier-2 impact card is the push half of clad_get_working_set — richer, so it
// needs a per-session governor: ONE Tier-2 card per (focus,file) per session (dedup),
// and a hard per-session token ceiling (budget). State lives in a sidecar keyed by the
// host session_id when present, else a 30-min rolling window. Sidecar contract (skip-agg
// precedent): corrupt/missing/new-session/rollover → a fresh ledger, never a throw.

const PUSH_LEDGER_FILE = 'hook-push-ledger.json';
const PUSH_WINDOW_MS = 30 * 60 * 1000;
/** Suppress further cards once this many pushed tokens accumulate in a session (AC-f4715e87). */
const PUSH_BUDGET_TOKENS = 2500;
const PUSH_BUDGET_NOTICE = 'cladding: push budget exhausted this session';

interface PushLedger {
  sessionKey: string;
  windowStart: number;
  est_tokens_pushed: number;
  fingerprints: Record<string, number>;
  notice_printed: boolean;
}

function pushLedgerPath(cwd: string): string {
  return join(cwd, '.cladding', PUSH_LEDGER_FILE);
}

/** Parse the sidecar into a shape-checked ledger; corrupt/missing → null (caller freshens). */
function readPushLedger(cwd: string): PushLedger | null {
  try {
    const o = JSON.parse(readFileSync(pushLedgerPath(cwd), 'utf8')) as Partial<PushLedger>;
    if (!o || typeof o !== 'object') return null;
    return {
      sessionKey: typeof o.sessionKey === 'string' ? o.sessionKey : '',
      windowStart: Number.isFinite(o.windowStart) ? Number(o.windowStart) : 0,
      est_tokens_pushed: Number.isFinite(o.est_tokens_pushed) ? Number(o.est_tokens_pushed) : 0,
      fingerprints: o.fingerprints && typeof o.fingerprints === 'object' ? {...(o.fingerprints as Record<string, number>)} : {},
      notice_printed: o.notice_printed === true,
    };
  } catch {
    return null;
  }
}

function writePushLedger(cwd: string, led: PushLedger): void {
  try {
    mkdirSync(dirname(pushLedgerPath(cwd)), {recursive: true});
    writeFileSync(pushLedgerPath(cwd), JSON.stringify(led), 'utf8');
  } catch {
    /* unwritable sidecar → the governor just won't persist; never a throw */
  }
}

/** Load the ledger for this invocation, resetting on a new session key OR a rolled-over
 * window (no session_id). sessionKey = host session_id when present, else a plain window. */
function loadPushLedger(cwd: string, sessionId: string, now: number): PushLedger {
  const key = sessionId ? `sid:${sessionId}` : 'win';
  const led = readPushLedger(cwd);
  if (!led || led.sessionKey !== key || (!sessionId && now - led.windowStart >= PUSH_WINDOW_MS)) {
    return {sessionKey: key, windowStart: now, est_tokens_pushed: 0, fingerprints: {}, notice_printed: false};
  }
  return led;
}

/**
 * The tiered push-card decision for an OWNED edit whose working set is built. Returns the
 * card text to print ('' = silence) and applies the session governor as a side effect:
 *   - budget exhausted (AC-f4715e87): suppress, one-time notice, record ledger_exhausted;
 *   - fresh (focus,file): Tier-2 when consequences exist else the Tier-1 one-liner, fired;
 *   - first repeat: degrade to the one-liner, record dedup;
 *   - later repeats: silence, record dedup (AC-61ae9211).
 *
 * `lane` tags impact_card_fired with the additive payload field lane:'bash'
 * (F-e7d59c88); the ledger rules themselves are lane-agnostic (AC-977e6445) —
 * a native Tier-2 for (focus,file) dedups a later Bash card for the same pair.
 */
function emitPushCard(cwd: string, sessionId: string, rel: string, ws: WorkingSet, lane?: 'bash'): string {
  const impacted = ws.breaks_if_changed.impacted;
  const tests = ws.breaks_if_changed.regression_tests;
  const highRisk = ws.verify.high_risk_acs;
  const hasConsequences = impacted.length > 0 || tests.length > 0 || highRisk.length > 0;
  const focusId = ws.must_edit.id;
  const fp = `post_tool_use|${focusId}|${rel}`;
  const now = Date.now();
  const led = loadPushLedger(cwd, sessionId, now);

  let card = '';
  if (led.est_tokens_pushed > PUSH_BUDGET_TOKENS) {
    // Budget exhausted: suppress cards entirely; the notice prints exactly once per session.
    recordImpactSkip(cwd, 'ledger_exhausted');
    if (!led.notice_printed) {
      card = PUSH_BUDGET_NOTICE;
      led.notice_printed = true;
    }
  } else {
    const seen = led.fingerprints[fp] ?? 0;
    if (seen === 0) {
      card = hasConsequences ? formatWorkingSetCard(ws, rel) : formatPushOneLiner(ws, rel);
      led.est_tokens_pushed += estTokens(card);
      recordFiredEvent(cwd, {
        file: rel,
        feature: focusId,
        impacted: impacted.length,
        tests: tests.length,
        unledgered: ws.breaks_if_changed.ledger?.depends_on_edges === 0,
        tier: hasConsequences ? 2 : 1,
        ...(lane ? {lane} : {}),
      });
    } else if (seen === 1) {
      card = formatPushOneLiner(ws, rel); // one Tier-2 per (focus,file) is the dose — degrade
      led.est_tokens_pushed += estTokens(card);
      recordImpactSkip(cwd, 'dedup');
    } else {
      recordImpactSkip(cwd, 'dedup'); // silence from the third repeat onward
    }
    led.fingerprints[fp] = seen + 1;
  }
  writePushLedger(cwd, led);
  return card;
}

/**
 * The shared owner-resolution → tiered-card pipeline, used by BOTH the native
 * write-tool lane and the Bash git-delta lane (F-e7d59c88). `rel` must be
 * repo-relative posix. `lane` tags impact_card_fired with the additive payload
 * field lane:'bash'; skips reuse the existing reasons unchanged (AC-977e6445 —
 * all F-35954d19 ledger rules apply lane-agnostically).
 */
function emitCardForPath(cwd: string, sessionId: string, rel: string, lane?: 'bash'): string {
  try {
    const spec = loadSpec(cwd);
    // Tier path: the Tier-2 impact card (code-free, 350-token lane — AC-1bfccb6b). A
    // buildWorkingSet throw OR lookup miss falls back byte-identically to the shipped
    // formatImpactCard path, leaving the callers' gates untouched (AC-38141a9e).
    let ws: WorkingSet | undefined;
    try {
      const built = buildWorkingSet(spec, rel, {includeCode: false, maxTokens: 350, cwd});
      if (!('not_found' in built)) ws = built;
    } catch {
      ws = undefined;
    }
    if (ws) return emitPushCard(cwd, sessionId, rel, ws, lane);
    const slice = buildImpactSlice(spec, rel);
    if ('not_found' in slice) {
      recordImpactSkip(cwd, 'owner_miss');
      return lane ? '' : unboundEditNudge(cwd);
    }
    const card = formatImpactCard(slice, rel);
    if (card) {
      recordImpactFired(cwd, rel, slice, lane);
      return card;
    }
    recordImpactSkip(cwd, 'owner_miss'); // found slice but no primary owner → no output
    return lane ? '' : unboundEditNudge(cwd);
  } catch {
    recordImpactSkip(cwd, 'spec_unreadable'); // spec unreadable → no card
    return '';
  }
}

// --- PostToolUse · Bash lane — git-delta impact cards (F-e7d59c88) --------
//
// Edits made THROUGH Bash (sed -i, heredoc, tee, git apply, mv) bypass the
// Edit|Write|MultiEdit matcher entirely — the sessions that shell out for
// edits are exactly the ones with zero ambient impact context. This lane
// closes the CARD half of that hole: the git working-tree delta since the
// stored snapshot attributes the mutation to a watched source path and routes
// it through the SAME tiered push pipeline (owner resolution, working-set
// tiering, ledger dedup/budget, telemetry). The BLOCK half intentionally
// stays open: a false-positive block on shell parsing is the fastest route to
// users disabling hooks, so this lane NEVER emits a block decision
// (AC-977e6445) — the Stop gate remains the enforcement lane.
//
// Fast path (AC-ab85ee3e): everything before the single `git status` spawn is
// an in-process string check — spec presence, a separate 20s debounce stamp,
// and a conservative read-only command allowlist — so the steady-state cost
// per shell command inside a window is one readFileSync.

const BASH_STAMP_FILE = 'hook-bash-ts';
const TREE_STATE_FILE = 'hook-tree-state.json';
/** Snapshot cap — bounds the per-window stat count and the sidecar size even
 * on a mid-rebase 1000-file dirty tree (~200 statSync calls, ~15KB json). */
const MAX_TREE_ENTRIES = 200;

/** Read-only command PREFIXES (matched against the trimmed tool_input.command):
 * a hit means "this command cannot have mutated source", so the lane skips the
 * git spawn entirely. Conservative in both senses — a prefix only matches at a
 * word boundary (`catalog` ≠ `cat`), and any shell metachar that could chain or
 * redirect into a mutation (; & | < > backtick $( or a newline) disqualifies
 * the match, so `echo x > src/a.ts` falls through to the delta check while a
 * bare `echo x` stays on the fast path. A false NEGATIVE here only costs one
 * git status per window; a false positive would cost a missed card. */
const READ_ONLY_BASH_PREFIXES: readonly string[] = [
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'ls',
  'cat',
  'grep',
  'rg',
  'find',
  'head',
  'tail',
  'wc',
  'echo',
  'pwd',
  'which',
  'node --version',
  'npm test',
  'npm run test',
  'npx vitest',
  'npx tsc',
  'yarn test',
];
const SHELL_MUTATION_CHARS = /[;&|<>`\n]|\$\(/;

function isReadOnlyBashCommand(command: string): boolean {
  if (command.length === 0) return true; // no command → nothing mutated
  if (SHELL_MUTATION_CHARS.test(command)) return false;
  return READ_ONLY_BASH_PREFIXES.some((p) => command === p || (command.startsWith(p) && /\s/.test(command[p.length])));
}

function treeStatePath(cwd: string): string {
  return join(cwd, '.cladding', TREE_STATE_FILE);
}

/** Read the tree snapshot — {paths: {"<repo-rel>": "<mtimeMs>:<size>"}}.
 * Corrupt/missing → empty (sidecar contract: never a throw). */
function readTreeSnapshot(cwd: string): Record<string, string> {
  try {
    const o = JSON.parse(readFileSync(treeStatePath(cwd), 'utf8')) as {paths?: unknown};
    const paths = asRecord(o.paths);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(paths)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeTreeSnapshot(cwd: string, paths: Record<string, string>): void {
  try {
    mkdirSync(dirname(treeStatePath(cwd)), {recursive: true});
    writeFileSync(treeStatePath(cwd), JSON.stringify({paths}), 'utf8');
  } catch {
    /* unwritable snapshot → worst case is one re-attributed card; never a throw */
  }
}

/**
 * AC-4f2df3ee — a native Edit/Write/MultiEdit completion (fired OR skipped)
 * refreshes JUST that path's snapshot entry, so the next Bash event cannot
 * re-attribute the hand-tool edit to a shell command. statSync only, no
 * subprocess. Per-edit adds may push the file past MAX_TREE_ENTRIES between
 * Bash rebuilds; the next delta refresh re-caps.
 */
function updateTreeSnapshotEntry(cwd: string, filePath: string, rel: string): void {
  try {
    const st = statSync(isAbsolute(filePath) ? filePath : join(cwd, filePath));
    const paths = readTreeSnapshot(cwd);
    paths[rel] = `${st.mtimeMs}:${st.size}`;
    writeTreeSnapshot(cwd, paths);
  } catch {
    /* unstat-able (deleted mid-flight) → skip; advisory lane, no error surface */
  }
}

/** Repo-relative paths git currently reports changed/untracked — the ONE
 * subprocess of the Bash lane. null when the cwd is not a git repo or git
 * fails (AC-14c2e2ea → the caller degrades to silence, snapshot untouched). */
function gitChangedPaths(cwd: string): string[] | null {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 10 * 1024 * 1024,
    });
    const paths: string[] = [];
    for (const line of out.split('\n')) {
      if (line.length < 4) continue; // porcelain v1: XY<space>path — path starts at col 3
      let p = line.slice(3);
      const arrow = p.indexOf(' -> '); // staged rename: attribute the NEW path
      if (arrow >= 0) p = p.slice(arrow + 4);
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1); // porcelain quoting
      if (p.length === 0 || p.endsWith('/')) continue; // collapsed untracked dir — not a file
      paths.push(p);
    }
    return paths;
  } catch {
    return null;
  }
}

interface BashDelta {
  /** Most-recently-modified newly-mutated watched path (repo-rel posix). */
  readonly path: string;
  /** Fresh snapshot content covering the watched dirty set (≤ cap). */
  readonly watched: Record<string, string>;
}

/** Diff the git-dirty watched set against the stored snapshot. newly-mutated =
 * absent from the snapshot OR mtime/size differ (statSync, no extra subprocess).
 * null = nothing to attribute (non-git / git failed / empty delta) → silence. */
function detectBashDelta(cwd: string): BashDelta | null {
  const changed = gitChangedPaths(cwd);
  if (changed === null) return null;
  const snapshot = readTreeSnapshot(cwd);
  const watched: Record<string, string> = {};
  let entries = 0;
  let newest: {path: string; mtime: number} | null = null;
  for (const p of changed) {
    if (!isWatchedSourcePath(p)) continue;
    if (entries >= MAX_TREE_ENTRIES) break;
    let st;
    try {
      st = statSync(join(cwd, p));
    } catch {
      continue; // deleted since git looked → nothing to attribute
    }
    entries++;
    const sig = `${st.mtimeMs}:${st.size}`;
    watched[p] = sig;
    if (snapshot[p] === sig) continue; // seen unchanged — e.g. a native edit already recorded (AC-4f2df3ee)
    if (!newest || st.mtimeMs > newest.mtime) newest = {path: p, mtime: st.mtimeMs};
  }
  return newest ? {path: newest.path, watched} : null;
}

/**
 * PostToolUse · Bash — attribution, not enforcement. Renders the same tiered
 * push card as the native-edit lane for the most-recently-modified newly-
 * mutated watched path, or degrades to silence. The min-chars gate does not
 * apply (a Bash mutation has no old/new strings to measure), and the lane
 * NEVER returns a block decision (AC-977e6445).
 */
function runBashLane(rec: Record<string, unknown>, cwd: string): string {
  // Not under cladding → no output, no telemetry, no .cladding/ writes (parity).
  if (!existsSync(join(cwd, 'spec.yaml'))) return '';
  const now = Date.now();
  // Separate stamp from the native lane's hook-drift-ts: Bash delta-checks once
  // per 20s window without consuming (or being consumed by) native-edit debounce.
  const stampPath = join(cwd, '.cladding', BASH_STAMP_FILE);
  try {
    const last = Number(readFileSync(stampPath, 'utf8').trim());
    if (Number.isFinite(last) && now - last < DRIFT_DEBOUNCE_MS) {
      recordImpactSkip(cwd, 'debounced');
      return '';
    }
  } catch {
    /* no stamp yet → proceed */
  }
  // Allowlist AFTER debounce, BEFORE any subprocess (AC-ab85ee3e). An allowlisted
  // command does NOT write the stamp — `ls` must not consume the window a
  // following `sed -i` needs. Counted into the existing not_write_tool sidecar
  // aggregation: semantically "this tool call could not have mutated source",
  // and the ImpactSkipReason enum stays closed (no new member).
  const command = asString(asRecord(rec.tool_input).command).trim();
  if (isReadOnlyBashCommand(command)) {
    aggregateImpactSkip(cwd, 'not_write_tool');
    return '';
  }
  // Stamp BEFORE the spawn: "≤1 git status per window" holds even if the spawn
  // or the pipeline throws (and a non-git cwd is probed once per window, not
  // once per shell command).
  try {
    mkdirSync(dirname(stampPath), {recursive: true});
    writeFileSync(stampPath, String(now), 'utf8');
  } catch {
    /* unwritable stamp → still run; worst case is an extra delta check */
  }
  const delta = detectBashDelta(cwd);
  if (delta === null) return ''; // AC-14c2e2ea: silence, NO snapshot write, no error
  const card = emitCardForPath(cwd, asString(rec.session_id), delta.path, 'bash');
  writeTreeSnapshot(cwd, delta.watched); // render-or-silence → the delta is now "seen"
  return card;
}

/**
 * After a source edit (debounced via `.cladding/hook-drift-ts`): surfaces a one-line IMPACT
 * card (the blast radius of the file just edited — the push half of clad_get_working_set) and,
 * when error-severity drift exists, a drift nudge. Ambient feedback, never a block.
 *
 * Each disposition also records value-delivery telemetry (F-6ba22c5c): a fired card →
 * impact_card_fired; a skip → impact_card_skipped tagged with the branch reason. Telemetry is
 * gated behind cladding presence so a spec-less cwd never gets .cladding/ writes (parity).
 */
function runPostToolUseDrift(input: unknown, cwd: string): string {
  const rec = asRecord(input);
  const underClad = existsSync(join(cwd, 'spec.yaml'));
  const tool = asString(rec.tool_name);
  // Bash routes to its own lane BEFORE the write-tool guard (F-e7d59c88):
  // shell-made edits carry no file_path and need git-delta attribution instead.
  if (tool === 'Bash') return runBashLane(rec, cwd);
  if (!WRITE_TOOLS.has(tool)) {
    if (underClad) aggregateImpactSkip(cwd, 'not_write_tool');
    return '';
  }
  const filePath = asString(asRecord(rec.tool_input).file_path);
  if (!isWatchedSourcePath(filePath)) {
    if (underClad) aggregateImpactSkip(cwd, 'unwatched_path');
    return '';
  }
  // Not under cladding → no drift nudges and no .cladding/ writes (SessionStart parity).
  // Disposition `no_spec` is in the enum but never emitted: a spec-less cwd gets no telemetry write.
  if (!underClad) return '';
  // Hosts send tool_input.file_path ABSOLUTE while moduleOwners keys are repo-relative posix —
  // without relativization the lookup never hits (measured 0/361 on cladding-self; 99.2% after).
  const rel = isAbsolute(filePath) ? relative(resolve(cwd), filePath).split(sep).join('/') : filePath;
  // AC-4f2df3ee: whatever happens below (fired OR skipped), this native edit is now
  // "seen" — the next Bash delta check must not re-attribute it to a shell command.
  updateTreeSnapshotEntry(cwd, filePath, rel);
  const stampPath = join(cwd, '.cladding', 'hook-drift-ts');
  const now = Date.now();
  try {
    const last = Number(readFileSync(stampPath, 'utf8').trim());
    if (Number.isFinite(last) && now - last < DRIFT_DEBOUNCE_MS) {
      recordImpactSkip(cwd, 'debounced');
      return '';
    }
  } catch {
    /* no stamp yet → run */
  }
  try {
    mkdirSync(dirname(stampPath), {recursive: true});
    writeFileSync(stampPath, String(now), 'utf8');
  } catch {
    /* unwritable stamp → still run; worst case is an extra drift pass */
  }
  // Impact card: the blast radius of the file just edited (skip trivial edits; degrade to '').
  let card = '';
  if (editMagnitude(rec.tool_input) < MIN_EDIT_CHARS) {
    recordImpactSkip(cwd, 'trivial_edit');
  } else {
    card = emitCardForPath(cwd, asString(rec.session_id), rel);
  }
  const report = runDrift({cwd, profile: 'interactive'});
  const errors = report.findings.filter((f) => f.severity === 'error');
  const deferred = report.skippedDetectors?.length ? ` (+${report.skippedDetectors.length} deferred to commit)` : '';
  // Plain-first render (F-dd8dc994): the plain English lead leads; the detector
  // id is demoted to a `(details: …)` tail; the deferred note is kept verbatim.
  // The count is preserved. Unknown-detector fallback keeps the truncated
  // message. The host agent renders the user's own language (F-9af291fa).
  let drift = '';
  if (errors.length > 0) {
    const lead = plainLead(errors[0].detector, truncate(errors[0].message, 140));
    drift = driftNudge(errors.length, lead, errors[0].detector, deferred);
  }
  return [card, drift].filter(Boolean).join('\n');
}

// --- dispatch + CLI wrapper ---------------------------------------------

/**
 * Handles one host hook event and returns the protocol output ('' = print
 * nothing / allow). Exported as a plain function so tests drive the protocol
 * without a host or a subprocess; never throws — an internal error degrades
 * to silence because a crashing hook must never brick the host session.
 */
export function runHookEvent(event: string, input: unknown, cwd: string): string {
  try {
    switch (event) {
      case 'SessionStart': {
        const out = renderSessionStartCard(cwd);
        // Value-delivery telemetry (F-6ba22c5c): a non-empty card is a served surface.
        // Wrapped separately so a telemetry failure can never swap `out` for '' (AC-e9d041de).
        if (out.length > 0) {
          try {
            recordEvent(cwd, 'session_card_rendered', {bytes: Buffer.byteLength(out, 'utf8')});
          } catch {
            /* observer-only */
          }
        }
        return out;
      }
      case 'UserPromptSubmit': {
        const s = classifyPromptSuggestion(input);
        if (s) {
          try {
            recordEvent(cwd, 'prompt_suggestion_served', {kind: s.kind});
          } catch {
            /* observer-only */
          }
        }
        return s?.text ?? '';
      }
      case 'PreToolUse':
        return resolvePreToolUseDecision(input, cwd);
      case 'Stop':
        return runStopGate(input, cwd);
      case 'PostToolUse':
        return runPostToolUseDrift(input, cwd);
      default:
        return ''; // unknown event → allow; forward-compatible with new host events
    }
  } catch {
    return ''; // error-as-silence at the protocol boundary
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/**
 * Handler for `clad hook <event>` — reads the event payload from stdin
 * (empty/malformed → `{}`), prints the protocol output, and ALWAYS exits 0.
 */
export async function runHookCommand(event: string): Promise<void> {
  let out = '';
  try {
    const raw = await readStdin();
    let input: unknown = {};
    if (raw.trim().length > 0) {
      try {
        input = JSON.parse(raw);
      } catch {
        input = {};
      }
    }
    out = runHookEvent(event, input, '.');
  } catch {
    out = '';
  }
  if (out.length > 0) process.stdout.write(`${out}\n`);
  process.exit(0);
}
