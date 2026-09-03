// Cladding · MCP server (v0.2.24, F-073 substep 1 / v0.3.0 substep B)
//
// `clad serve` exposes cladding to MCP clients (Claude Code, Cursor,
// Continue, Cline, …) as an MCP server. Phase A ships the read-only
// surface: tools that query the spec / run drift / tail events, plus
// resources for spec.yaml / events.log / audit.log, plus prompt
// templates wrapping each persona body. Sampling-based dispatch (the
// transport the drive loop will use) lands in v0.2.25.
//
// Architectural placement: the server is a *thin* read layer over
// cladding's existing modules. It does not duplicate logic — every
// handler calls a real cladding function and translates the result
// into MCP shapes. That keeps `clad serve` and `clad check` /
// `clad sync` / `clad run` running the same drift detectors,
// the same spec loader, the same audit log — only the transport
// differs.
//
// @see src/cli/serve.ts — stdio process entry point.
// @see spec/features/F-073.yaml AC-206 /
//      AC-207 / AC-208 / AC-209 / AC-210 — server scaffold AC matrix.

import {spawnSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, existsSync, mkdirSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TextDecoder} from 'node:util';
import {deflateRawSync, inflateRawSync} from 'node:zlib';
import {tmpdir} from 'node:os';

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

import {loadPersona} from '../agents/loader.js';
import {readEventLogLines, recordEvent} from '../events/log.js';
import {onboardingCompletionMessage} from '../ui/softShell.js';
import {collectChangelog, defaultSinceRef} from '../changelog/collect.js';
import {renderAuditTable, renderCatalog, renderChangelogMarkdown} from '../changelog/render.js';
import {subscribeAudit} from '../hitl/audit.js';
import {loadSpec} from '../spec/load.js';
import type {Spec} from '../spec/types.js';
import {createScenario, createSchema01FeatureComposite, generateFeatureId, linkCapability, resolveDesignImpact} from '../spec/new.js';
import {editSpec, prepareSpecEdit, readSpecEditRevisions, specEditOperationsSchema, type SpecEditOperation, SpecEditError, withSpecWorkspaceLock} from '../spec/edit.js';
import {requiredRootSchema} from '../spec/transaction.js';
import {readSchema02AuthoringSnapshot} from '../spec/compiler/authoring-view.js';
import {idPolicyDescription, readableIdPattern} from '../spec/compiler/id-policy.js';
import {recordOracle} from '../oracle/record.js';
import {doneFeatureCount, oracleRequired, resolveOraclePolicy} from '../oracle/policy.js';
import {buildContextSlice} from '../optimizer/context-slice.js';
import {graphIrView} from '../graph/query.js';
import {buildImpactSlice} from '../optimizer/reverse-slice.js';
import {buildWorkingSet} from '../optimizer/working-set.js';
import {loadGraphIrV2Workspace} from '../graph/query.js';
import {focusedProjectionV2, statisticsV2, type WireEnvelopeV2} from '../graph/wire-v2.js';
import {runDrift} from '../stages/drift.js';
import {ingestPortableReceipt} from '../proof/ingest.js';
import {recordAssertedSignoff} from '../proof/signoff.js';
import {emptyTrustSnapshot, parsePortableReceiptYaml, type PortableReceipt, type ReceiptExpectedDigestContext, type TrustSnapshot} from '../proof/receipt.js';

/** Persona ids registered as MCP prompts (mirrors src/agents/). */
export const PERSONA_IDS = [
  'orchestrator',
  'planner',
  'reviewer',
  'observability',
  'developer',
] as const;

/**
 * 0.6.0 persona renames (docs/glossary.md). The old prompt names stay
 * registered as aliases serving the NEW persona body — hosts may have cached
 * the prompt names — and are removed in 0.8 (still shipped through 0.7.x).
 */
export const PERSONA_PROMPT_ALIASES: Readonly<Record<string, string>> = {
  librarian: 'planner',
  specialists: 'developer',
};

/** Tool names cladding's MCP server exposes (stable wire identifiers). */
export const TOOL_NAMES = [
  'clad_prepare_init',
  'clad_stage_init',
  'clad_init',
  'clad_prepare_clarify',
  'clad_clarify',
  'clad_resolve_onboarding_review',
  'clad_list_features',
  'clad_get_feature',
  'clad_run_check',
  'clad_get_events',
  'clad_edit_spec',
  'clad_prepare_spec_edit',
  'clad_begin',
  'clad_create_feature',
  'clad_resolve_design_impact',
  'clad_create_scenario',
  'clad_link_capability',
  'clad_ingest_receipt',
  'clad_signoff',
  'clad_author_oracle',
  'clad_run_gate',
  'clad_verdict',
  'clad_get_context',
  'clad_get_working_set',
  'clad_get_impact',
  'clad_get_graph',
  'clad_changelog',
] as const;

/** Resource URIs cladding's MCP server exposes (stable wire identifiers). */
export const RESOURCE_URIS = {
  spec: 'cladding://spec',
  events: 'cladding://events',
  audit: 'cladding://audit',
} as const;

export interface ServerOptions {
  /** Project root used to resolve spec / events / audit paths. */
  readonly cwd?: string;
  /** Server name advertised to clients (defaults to `cladding`). */
  readonly name?: string;
  /** Server version advertised to clients. */
  readonly version?: string;
  /** In-process onboarding operations supplied by the CLI composition root. */
  readonly onboarding?: OnboardingOperations;
  /** Immutable host/install-provided evidence dependencies; never MCP arguments. */
  readonly evidence?: EvidenceOperations;
}

/**
 * Projects the MCP assurance request onto the sole CLI gate transport.
 *
 * A canonical profile intentionally omits the legacy default tier so the CLI
 * can choose profile-owned execution rather than receive a fabricated alias
 * conflict.  Keeping this vector pure makes positive CLI/MCP parity
 * independently fixtureable without invoking either runner twice.
 */
export function cladRunGateCliArgs(input: {
  readonly tier?: 'pre-commit' | 'pre-push' | 'all';
  readonly profile?: 'feedback' | 'checkpoint' | 'completion' | 'push' | 'release';
  readonly assuranceLevel?: 'L1' | 'L2' | 'L3' | 'L4';
  readonly strict: boolean;
}): readonly string[] {
  return [
    'check',
    ...(input.tier ? [`--tier=${input.tier}`] : input.profile ? [] : ['--tier=pre-commit']),
    ...(input.profile ? [`--profile=${input.profile}`] : []),
    ...(input.assuranceLevel ? [`--assurance-level=${input.assuranceLevel}`] : []),
    ...(input.strict ? ['--strict'] : []),
    '--json',
  ];
}

/** Wraps the unmodified CLI assurance projection in the MCP wire envelope. */
export function cladRunGatePayload<T extends Readonly<Record<string, unknown>>>(document: T): T & {readonly schema_version: number} {
  return {...document, schema_version: PAYLOAD_SCHEMA_VERSION};
}

/** F5 trust and expected-digest dependencies injected by a registered host. */
export interface EvidenceOperations {
  readonly trustSnapshot?: TrustSnapshot;
  readonly expectedDigestContext?: (receipt: PortableReceipt) => ReceiptExpectedDigestContext | undefined;
}

/** Process-independent onboarding contract injected at the serve boundary. */
export interface OnboardingOperations {
  readonly renderDraft: (draft: unknown) => string;
  readonly prepareInit: (opts: {cwd: string; mode: string; intent: string}) => {
    readonly prompt: string;
    readonly request: {readonly mode: string; readonly intent: string};
    readonly observation: Record<string, unknown>;
  };
  readonly initialize: (opts: {
    cwd: string;
    intent?: string;
    scan?: boolean;
    noLlm?: boolean;
    hostDispatcher?: (prompt: string) => Promise<string>;
  }) => Promise<{
    readonly created?: readonly string[];
    readonly skipped?: readonly string[];
    readonly language?: string;
    readonly proposals?: readonly string[];
    readonly clarifyingQuestions?: readonly string[];
    readonly onboardingMode?: 'greenfield' | 'existing-adoption' | 'mixed';
    readonly onboardingSource?: 'llm' | 'hybrid' | 'deterministic';
  }>;
  readonly prepareClarify: (
    answer: string,
    opts: {cwd: string},
  ) => {readonly prompt: string; readonly request: {readonly mode: string; readonly intent: string}; readonly observation: Record<string, unknown>} | {readonly error: string};
  readonly clarify: (
    answer: string,
    opts: {cwd: string; noLlm?: boolean; hostDispatcher?: (prompt: string) => Promise<string>},
  ) => Promise<{
    readonly ok: boolean;
    readonly error?: string;
    readonly report?: unknown;
    readonly source?: 'llm' | 'hybrid' | 'deterministic';
  }>;
  readonly resolveReview: (
    targets: readonly string[],
    opts: {cwd: string},
  ) => {readonly ok: boolean; readonly changed: boolean; readonly status?: string; readonly remaining?: readonly string[]; readonly error?: string};
}

/**
 * Builds and returns a configured McpServer instance for the given
 * cladding project. The caller is responsible for attaching a
 * Transport via `server.connect(transport)` — `src/cli/serve.ts`
 * wires a StdioServerTransport in the production CLI path; tests
 * use an in-memory transport pair instead.
 *
 * The server is *not* connected to a transport when this returns,
 * so the same factory is reused by both production and test code.
 */
export function buildServer(opts: ServerOptions = {}): McpServer {
  const cwd = opts.cwd ?? '.';
  const server = new McpServer(
    {
      name: opts.name ?? 'cladding',
      version: opts.version ?? '0.9.4',
    },
    {
      instructions:
        'For explicit Cladding onboarding, always call clad_prepare_init first, draft the requested structured data ' +
        'with the current host model, then call clad_stage_init before showing the planned changes. Wait for a separate ' +
        'user confirmation before calling clad_init with the confirmation verbatim. For each real user answer, call ' +
        'clad_prepare_clarify and then clad_clarify only after a new user message supplies the answer. Never infer an ' +
        'answer or call clarify during the initialization approval turn. Never run onboarding shell commands or request MCP sampling. ' +
        'Prepare tools are read-only; apply tools validate and write.',
      // Declare subscribe support so clients can subscribe to
      // cladding://audit and receive notifications/resources/updated
      // when new evidence lands. The wire-level handlers themselves
      // are registered below in registerSubscribeHandlers — the
      // McpServer high-level wrapper does not include them by
      // default (verified against SDK 1.29 sources).
      capabilities: {resources: {subscribe: true}},
    },
  );

  registerTools(server, cwd, opts.onboarding, opts.evidence);
  registerResources(server, cwd);
  registerPrompts(server, cwd);
  registerSubscribeHandlers(server);
  registerAuditNotifier(server, cwd);
  return server;
}

/**
 * Adds no-op resources/subscribe + resources/unsubscribe handlers.
 *
 * cladding currently has a single connected client per server
 * (stdio or in-memory pair), so it doesn't need to track per-client
 * subscription state — every notification fans out to whoever is
 * listening. The handlers exist solely so the client receives a
 * successful response instead of `-32601: Method not found` when
 * it issues a `resources/subscribe` request.
 */
function registerSubscribeHandlers(server: McpServer): void {
  server.server.setRequestHandler(SubscribeRequestSchema, async () => ({}));
  server.server.setRequestHandler(UnsubscribeRequestSchema, async () => ({}));
}

/**
 * Wires the audit observer that fires `notifications/resources/updated`
 * for `cladding://audit` whenever a new evidence entry lands. This is
 * what lets an MCP client live-tail the audit log without polling.
 *
 * The observer survives for the lifetime of the server. Closing the
 * server does not auto-dispose it — the cladding process exits
 * shortly after server.close() in the production CLI path. Tests
 * dispose explicitly via `clearAuditObserversForTesting()`.
 *
 * Only writes whose `cwd` matches the server's project root produce
 * a notification — other cladding processes appending to *their*
 * audit log under a different cwd are ignored.
 */
function registerAuditNotifier(server: McpServer, cwd: string): void {
  subscribeAudit((auditCwd) => {
    if (auditCwd !== cwd) return;
    // sendResourceUpdated emits the typed
    // `notifications/resources/updated` notification. Returns a
    // Promise we don't await — observer hooks are synchronous and
    // we don't want a slow network send to block the audit append.
    void server.server.sendResourceUpdated({uri: RESOURCE_URIS.audit});
  });
}

/**
 * Loads the spec, or returns a human-readable reason it could not be loaded.
 *
 * The read surfaces (clad_list_features / clad_get_feature / the spec
 * resource) call `loadSpec`, which THROWS when spec.yaml is absent or
 * unparseable. An absent spec is a normal "not initialised yet" state, not a
 * server fault — an unguarded throw would crash the MCP tool call (the host
 * sees an opaque internal error). This wraps the throw into a graceful result
 * the handlers turn into an `isError` reply / error payload. (Detectors handle
 * the same throw via their own try/catch — see detectors/with-spec.ts — so the
 * `loadSpec` contract itself is intentionally left unchanged.)
 */
function loadSpecOrError(cwd: string): {readonly spec: Spec} | {readonly error: string} {
  try {
    return {spec: loadSpec(cwd)};
  } catch (err) {
    return {
      error: `cladding: spec not loaded — ${(err as Error).message}. Run \`clad init\` to scaffold spec.yaml first.`,
    };
  }
}

/** Deterministic mutation boundary for a setup-only workspace. */
function requireInitialized(cwd: string): string | null {
  const rootPath = join(cwd, 'spec.yaml');
  if (!existsSync(rootPath)) {
    return 'cladding: not_initialized — this project has host wiring but no valid spec.yaml; ' +
      'ordinary work must remain ordinary until the user explicitly requests Cladding initialization.';
  }
  try {
    if (requiredRootSchema(cwd) === '0.2') {
      readSchema02AuthoringSnapshot(cwd);
      return null;
    }
  } catch (error) {
    return `cladding: specification is not ready — ${(error as Error).message}`;
  }
  const loaded = loadSpecOrError(cwd);
  if (!('error' in loaded)) return null;
  return 'cladding: not_initialized — this project has host wiring but no valid spec.yaml; ' +
    'ordinary work must remain ordinary until the user explicitly requests Cladding initialization.';
}

/**
 * Serializes one graph envelope EXACTLY as the packer measured it.
 *
 * `meta.payload_utf8_bytes` is the fixed point of `JSON.stringify(envelope)`, so any
 * re-serialization — indentation, an added field — would make the reported size a lie
 * and break the ceiling the packer trimmed to.
 */
function graphPayload(envelope: WireEnvelopeV2): string {
  return JSON.stringify(envelope);
}

function initializedMutationBoundary(cwd: string): ReturnType<typeof mcpPayload> | null {
  const error = requireInitialized(cwd);
  return error ? mcpPayload({ok: false, code: 'NOT_INITIALIZED', message: error}, true) : null;
}

/** Frozen wire field (F-570a3f): bump when a tool's payload shape changes. */
const PAYLOAD_SCHEMA_VERSION = 1;
/**
 * The graph surface versions on its own. `clad_get_context` and every other tool
 * stay on PAYLOAD_SCHEMA_VERSION 1 — a separately accepted, frozen contract — so
 * GraphIR wire evolution can never drag an unrelated payload shape with it.
 *
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-e5fc267b
 */
const GRAPH_SCHEMA_VERSION = 2;
// Observe responses share the D24 task-profile ceiling. This is separate from
// the edit packet limit by purpose, but intentionally equal in byte budget.
const EVENT_RESPONSE_BYTE_LIMIT = 16 * 1024;
const EVENT_PROJECTION_BYTE_LIMIT = 6 * 1024;
const MUTATION_REQUEST_BYTE_LIMIT = 16 * 1024;
const SHA256_DIGEST = /^[a-f0-9]{64}$/;

// This is the edit engine's executable discriminated union, not a parallel
// transport approximation. Discovery therefore exposes each operation's
// required and forbidden fields before a host reaches the mutation handler.
const typedSpecEditOperationsSchema = specEditOperationsSchema;

/**
 * F-570a3f — the gate state rides every mutating tool result as a JSON field
 * (the withHint pattern; never appended text). Tool results are the one
 * channel the model cannot not see, on every host — and Gemini/Codex have no
 * lifecycle hooks, so this is their only structural enforcement channel.
 */
function gateFooter(cwd: string): {
  pass: boolean;
  /** True when the drift engine itself failed — the gate DID NOT RUN (≠ verified green). */
  unavailable?: boolean;
  findings: ReadonlyArray<{detector?: string; severity: string; message: string}>;
  next?: string;
} {
  try {
    const report = runDrift({cwd});
    const findings = report.findings
      .filter((f) => f.severity !== 'info')
      .slice(0, 3)
      .map((f) => ({detector: f.detector, severity: f.severity, message: f.message.slice(0, 220)}));
    return report.pass
      ? {pass: true, findings}
      : {pass: false, findings, next: 'Resolve these findings, then verify with clad_run_gate (or `clad check --strict`) before `clad done`.'};
  } catch {
    // An engine fault must never read as a verified GREEN on the one structural
    // channel hook-less hosts see (F-c6a32fff). pass:false is fail-closed; the
    // explicit flag distinguishes "could not run" from "ran and found problems".
    return {pass: false, unavailable: true, findings: [], next: 'gate could not run — verify with `clad check --strict`.'};
  }
}


/**
 * Value-delivery telemetry (F-6ba22c5c): records that an MCP read tool served
 * a result. Observer-only — recordEvent is best-effort and this is additionally
 * wrapped, so a telemetry failure never changes the tool's returned content
 * (AC-e9d041de). Reached only after loadSpecOrError succeeds, so a spec-less cwd
 * (no .cladding/) is never written to.
 */
function recordServe(
  cwd: string,
  tool: string,
  query: string,
  resolved: boolean,
  extra?: {truncated: boolean; sliceTokens: number},
): void {
  try {
    recordEvent(cwd, 'working_set_served', {tool, query, resolved, ...(extra ?? {})});
  } catch {
    /* observer-only */
  }
}

/** Locates the CLI shim for legacy MCP tools that still wrap CLI verbs. */
function engineShim(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'bin', 'clad');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  const runningEntry = process.argv[1];
  return runningEntry && basename(runningEntry) === 'clad.js' && existsSync(runningEntry)
    ? runningEntry
    : null;
}

const INTENT_FILE_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.markdown']);

/**
 * Rejects ambiguous document paths and bytes before they reach the host model.
 *
 * @see spec/features/natural-language-init-0f4dd6.yaml AC-003
 */
function projectIntentPath(cwd: string, requested: string): {path?: string; text?: string; error?: string} {
  if (!requested.trim()) return {error: 'document_path is required for document mode'};
  if (isAbsolute(requested)) return {error: 'document_path must be relative to the connected project'};
  const root = realpathSync(resolve(cwd));
  const candidate = resolve(root, requested);
  if (!existsSync(candidate)) return {error: `planning document not found: ${requested}`};
  let target: string;
  try {
    target = realpathSync(candidate);
  } catch (error) {
    return {error: `planning document could not be resolved: ${(error as Error).message}`};
  }
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return {error: 'planning document must stay inside the connected project'};
  }
  if (!statSync(target).isFile()) return {error: 'planning document must be a regular file'};
  if (!INTENT_FILE_EXTENSIONS.has(extname(target).toLowerCase())) {
    return {error: 'planning document must be .md, .txt, .yaml, .yml, or .markdown'};
  }
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(readFileSync(target));
    return {path: rel, text};
  } catch (error) {
    return {error: `planning document is not readable UTF-8 text: ${(error as Error).message}`};
  }
}

const hostDraftSchema = z.object({
  mode: z.enum(['greenfield', 'existing-adoption', 'mixed']),
  project_context: z.object({why: z.string().min(1), problem: z.string().min(1), purpose: z.string().min(1)}).strict(),
  capabilities: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    surface: z.enum(['feature', 'platform', 'tool', 'infrastructure']),
  }).strict()).min(3).max(8),
  architecture: z.object({layers: z.array(z.object({name: z.string().min(1), forbidden_imports: z.array(z.string())}).strict())}).strict(),
  scenarios: z.array(z.object({slug: z.string().min(1), title: z.string().min(1), flow: z.string().min(1)}).strict()).min(1).max(3),
  questions: z.array(z.string().min(1)).max(3),
  ai_hints: z.record(z.string(), z.unknown()).optional(),
}).strict();
type HostDraft = z.infer<typeof hostDraftSchema>;

interface PreparedOnboarding {
  readonly kind: 'init' | 'clarify';
  readonly snapshot: string;
  readonly mode: 'idea' | 'document' | 'existing';
  readonly intent: string;
  readonly answer?: string;
  readonly refresh?: boolean;
  /** Exact preview-bound phrase required at the destructive init boundary. */
  readonly approvalChallenge?: string;
  /** Force scan when any source code was observed, including document-led adoption. */
  readonly scan?: boolean;
}

const MAX_APPROVAL_ENVELOPE_BYTES = 1_000_000;
const PREPARATION_TTL_MS = 30 * 60 * 1000;

/**
 * Carries preparation state across host process restarts.
 *
 * The digest detects truncation/corruption; authorization still comes from the
 * separately displayed exact challenge. Workspace freshness makes a consumed
 * envelope stale after the first successful write. Prepare writes no authored
 * project files, but it does persist a TTL'd consent-cache envelope: under the
 * OS temp dir (owner-only 0600) until a draft is staged, then under the
 * ignored `.cladding/host/onboarding-pending/`.
 */
function encodePreparedOnboarding(request: PreparedOnboarding): string {
  const body = deflateRawSync(Buffer.from(JSON.stringify(request))).toString('base64url');
  const digest = createHash('sha256').update(body).digest('hex').slice(0, 24);
  return `v1.${digest}.${body}`;
}

function decodePreparedOnboarding(token: string): PreparedOnboarding | null {
  const match = /^v1\.([a-f0-9]{24})\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return null;
  if (createHash('sha256').update(match[2]).digest('hex').slice(0, 24) !== match[1]) return null;
  try {
    const value = JSON.parse(inflateRawSync(Buffer.from(match[2], 'base64url'), {
      maxOutputLength: MAX_APPROVAL_ENVELOPE_BYTES,
    }).toString('utf8')) as PreparedOnboarding;
    if ((value.kind !== 'init' && value.kind !== 'clarify') || typeof value.snapshot !== 'string' || typeof value.intent !== 'string') {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function pendingPreparationPath(cwd: string, key: string, durable = false): string {
  const id = createHash('sha256').update(`${resolve(cwd)}\0${key}`).digest('hex');
  return durable
    ? join(cwd, '.cladding', 'host', 'onboarding-pending', `${id}.json`)
    : join(tmpdir(), 'cladding-onboarding-pending', `${id}.json`);
}

/**
 * Removes every expired consent-cache envelope in `dir`, not just the current
 * key's: abandoned prepare flows used to leave 0600 envelopes behind until the
 * next same-key load — on a shared machine the temp tier accumulated hundreds.
 */
function purgeExpiredPreparations(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const path = join(dir, name);
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {expiresAt?: number};
      if (!parsed.expiresAt || parsed.expiresAt < Date.now()) rmSync(path, {force: true});
    } catch {
      rmSync(path, {force: true});
    }
  }
}

function persistPendingPreparation(
  cwd: string,
  key: string,
  token: string,
  request: PreparedOnboarding,
  draft?: HostDraft,
): void {
  const path = pendingPreparationPath(cwd, key, draft != null);
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  purgeExpiredPreparations(dirname(path));
  writeFileSync(path, JSON.stringify({expiresAt: Date.now() + PREPARATION_TTL_MS, token, request, draft}), {mode: 0o600});
}

function loadPendingPreparation(
  cwd: string,
  key: string,
): {readonly token: string; readonly request: PreparedOnboarding; readonly draft?: HostDraft} | null {
  for (const durable of [true, false]) {
    const path = pendingPreparationPath(cwd, key, durable);
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        expiresAt?: number;
        token?: string;
        request?: PreparedOnboarding;
        draft?: HostDraft;
      };
      if (!parsed.expiresAt || parsed.expiresAt < Date.now() || !parsed.token || !parsed.request) {
        rmSync(path, {force: true});
        continue;
      }
      if (parsed.draft !== undefined) {
        // The durable cache crosses process boundaries, so a staged draft is
        // re-validated on load — a tampered/corrupted cache must surface as
        // draft_required, never reach renderDraft (AC-014 extension).
        const revalidated = hostDraftSchema.safeParse(parsed.draft);
        if (!revalidated.success) {
          rmSync(path, {force: true});
          continue;
        }
        return {token: parsed.token, request: parsed.request, draft: revalidated.data};
      }
      return {token: parsed.token, request: parsed.request};
    } catch {
      // Try the other cache tier. A missing durable cache is normal before staging.
    }
  }
  return null;
}

function removePendingPreparation(cwd: string, key: string): void {
  rmSync(pendingPreparationPath(cwd, key), {force: true});
  rmSync(pendingPreparationPath(cwd, key, true), {force: true});
}

/** Returns a short, one-time phrase that is easy for a human to verify and hard to pass accidentally. */
function approvalChallenge(): string {
  return `APPLY CLADDING ${randomUUID().slice(0, 6).toUpperCase()}`;
}

function workspaceSnapshot(cwd: string): string {
  const hash = createHash('sha256');
  const visit = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || entry.name === '.cladding' || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      const rel = relative(cwd, path);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const stat = statSync(path);
        hash.update(`${rel}\0${stat.size}\0${stat.mtimeMs}\n`);
      }
    }
  };
  visit(cwd);
  return hash.digest('hex');
}

/** Binds approval to authored files plus the active onboarding conversation. */
function onboardingPreparationSnapshot(cwd: string): string {
  const hash = createHash('sha256').update(workspaceSnapshot(cwd));
  const statePath = join(cwd, '.cladding', 'onboarding', 'state.yaml');
  hash.update(existsSync(statePath) ? readFileSync(statePath) : Buffer.from('absent'));
  return hash.digest('hex');
}

const ONBOARDING_WRITE_ROOTS = [
  'spec.yaml', '.gitignore', 'AGENTS.md',
  'docs/conventions.md', 'docs/project-context.md',
  'spec/architecture.yaml', 'spec/capabilities.yaml', 'spec/scenarios',
  '.cladding/onboarding', '.cladding/scan',
] as const;

interface OnboardingRollback {
  readonly files: ReadonlyMap<string, Buffer>;
  readonly directories: ReadonlySet<string>;
}

function capturePathRollback(cwd: string, roots: readonly string[]): OnboardingRollback {
  const files = new Map<string, Buffer>();
  const directories = new Set<string>();
  const visit = (relativePath: string): void => {
    const path = join(cwd, relativePath);
    if (!existsSync(path)) return;
    const stat = statSync(path);
    if (stat.isFile()) {
      files.set(relativePath, readFileSync(path));
      return;
    }
    if (!stat.isDirectory()) return;
    directories.add(relativePath);
    for (const name of readdirSync(path)) visit(join(relativePath, name));
  };
  for (const root of roots) visit(root);
  return {files, directories};
}

function restorePathRollback(cwd: string, roots: readonly string[], rollback: OnboardingRollback): void {
  for (const root of roots) rmSync(join(cwd, root), {recursive: true, force: true});
  for (const directory of [...rollback.directories].sort((a, b) => a.length - b.length)) {
    mkdirSync(join(cwd, directory), {recursive: true});
  }
  for (const [relativePath, body] of rollback.files) {
    mkdirSync(dirname(join(cwd, relativePath)), {recursive: true});
    writeFileSync(join(cwd, relativePath), body);
  }
}

/** Captures only paths the MCP onboarding core is allowed to mutate. */
function captureOnboardingRollback(cwd: string): OnboardingRollback {
  return capturePathRollback(cwd, ONBOARDING_WRITE_ROOTS);
}

/** Restores the bounded onboarding surface after any failed multi-file apply. */
function restoreOnboardingRollback(cwd: string, rollback: OnboardingRollback): void {
  restorePathRollback(cwd, ONBOARDING_WRITE_ROOTS, rollback);
}

function mcpPayload(payload: Record<string, unknown>, isError = false): {
  readonly isError?: boolean;
  readonly structuredContent: Record<string, unknown>;
  readonly content: Array<{readonly type: 'text'; readonly text: string}>;
} {
  return {
    ...(isError ? {isError: true} : {}),
    structuredContent: payload,
    content: [{type: 'text', text: JSON.stringify(payload, null, 2)}],
  };
}

/** Builds one bounded event projection shared by the tool and resource transports. */
function recentEventProjection(cwd: string, limit: number): Record<string, unknown> {
  const lines = readEventLogLines(cwd);
  if (!lines) {
    return {ok: true, code: 'OK', message: 'No event history has been recorded yet.', events: [], byte_limit: EVENT_RESPONSE_BYTE_LIMIT};
  }
  const parse = (line: string): unknown => {
    try { return JSON.parse(line) as unknown; } catch { return {unparseable: line.slice(0, 200)}; }
  };
  const render = (events: readonly unknown[], oversized: number): Record<string, unknown> => ({
    ok: true,
    code: 'OK',
    message: 'Recent event history.',
    events,
    ...(lines.length > events.length ? {omitted_events: lines.length - events.length} : {}),
    ...(oversized > 0 ? {oversized_events: oversized} : {}),
    byte_limit: EVENT_RESPONSE_BYTE_LIMIT,
  });
  const selected: unknown[] = [];
  let oversized = 0;
  for (const line of lines.slice(-limit).reverse()) {
    const event = parse(line);
    const candidate = [event, ...selected];
    if (Buffer.byteLength(JSON.stringify(render(candidate, oversized))) > EVENT_PROJECTION_BYTE_LIMIT) {
      if (Buffer.byteLength(JSON.stringify(render([event], oversized))) > EVENT_PROJECTION_BYTE_LIMIT) oversized++;
      break;
    }
    selected.unshift(event);
  }
  let projection = render(selected, oversized);
  while (selected.length > 0 && Buffer.byteLength(JSON.stringify(projection)) > EVENT_PROJECTION_BYTE_LIMIT) {
    selected.shift();
    projection = render(selected, oversized);
  }
  return projection;
}

/** Keeps the final duplicated MCP tool envelope under its 16 KiB wire ceiling. */
function boundedEventMcpPayload(payload: Record<string, unknown>, isError = false): ReturnType<typeof mcpPayload> {
  const bounded: Record<string, unknown> = {...payload};
  while (true) {
    const result = mcpPayload(bounded, isError);
    if (Buffer.byteLength(JSON.stringify(result)) <= EVENT_RESPONSE_BYTE_LIMIT) return result;
    const events = bounded.events;
    if (Array.isArray(events) && events.length > 0) {
      bounded.events = events.slice(1);
      bounded.omitted_events = Number(bounded.omitted_events ?? 0) + 1;
      continue;
    }
    return mcpPayload({ok: false, code: 'EVENT_RESPONSE_TOO_LARGE', message: 'Event history could not fit in the response limit.', byte_limit: EVENT_RESPONSE_BYTE_LIMIT}, true);
  }
}

/** Applies the shared F4 ingress ceiling before any adapter reaches a writer. */
function oversizedMutationRequest(value: unknown): ReturnType<typeof mcpPayload> | null {
  return Buffer.byteLength(JSON.stringify(value)) > MUTATION_REQUEST_BYTE_LIMIT
    ? mcpPayload({ok: false, code: 'INVALID_OPERATION', message: 'This request exceeds the 16 KiB mutation limit.'}, true)
    : null;
}

/** Preserves one stable, duplicated domain envelope for legacy convenience tools. */
function mutationPayload(payload: Record<string, unknown>, isError = false): ReturnType<typeof mcpPayload> {
  const suppliedCode = payload.code;
  const suppliedMessage = payload.message;
  const data = Object.fromEntries(Object.entries(payload)
    .filter(([key]) => key !== 'ok' && key !== 'code' && key !== 'message'));
  return mcpPayload({
    ok: !isError,
    code: isError ? String(suppliedCode ?? 'INVALID_OPERATION') : 'OK',
    message: String(suppliedMessage ?? (isError ? 'The requested change could not be applied.' : 'The requested change was applied.')),
    ...data,
  }, isError);
}

/** One executable gate wire schema shared by every mutating F4 adapter. */
const gateOutputSchema = z.object({
  pass: z.boolean(),
  unavailable: z.boolean().optional(),
  findings: z.array(z.object({detector: z.string().optional(), severity: z.string(), message: z.string()})),
  next: z.string().optional(),
});

/** Fields carried by every stable mutation response, success and domain error alike. */
const mutationOutputSchema = {
  ok: z.boolean(), code: z.string(), message: z.string(), schema_version: z.literal(PAYLOAD_SCHEMA_VERSION).optional(),
  changed: z.boolean().optional(),
};
const designImpactValueSchema = z.union([
  z.object({status: z.literal('review_required'), artifacts: z.array(z.string()), next: z.string()}),
  z.object({status: z.literal('resolved'), classification: z.enum(['none', 'additive'])}),
]);
const createFeatureOutputSchema = {
  ...mutationOutputSchema,
  id: z.string().optional(), slug: z.string().optional(), path: z.string().optional(), note: z.string().optional(),
  hint: z.string().optional(), designImpact: designImpactValueSchema.optional(),
  inputRevisions: z.record(z.string(), z.string()).optional(), contextRevision: z.string().optional(), checkpointedFeatures: z.array(z.string()).optional(),
  gate: gateOutputSchema.optional(),
};
const designImpactOutputSchema = {...mutationOutputSchema, feature: z.string().optional(), path: z.string().optional(), gate: gateOutputSchema.optional()};
const oracleOutputSchema = {...mutationOutputSchema, oraclePath: z.string().optional(), evidenceId: z.string().optional(), reason: z.string().optional(), voluntary: z.literal(true).optional(), cost_note: z.string().optional(), gate: gateOutputSchema.optional()};
const scenarioOutputSchema = {...mutationOutputSchema, id: z.string().optional(), slug: z.string().optional(), path: z.string().optional(), gate: gateOutputSchema.optional()};
const capabilityLinkOutputSchema = {...mutationOutputSchema, capability: z.string().optional(), feature: z.string().optional(), created: z.boolean().optional(), alreadyLinked: z.boolean().optional(), path: z.string().optional(), gate: gateOutputSchema.optional()};

function registerTools(server: McpServer, cwd: string, onboarding?: OnboardingOperations, evidence?: EvidenceOperations): void {
  const prepared = new Map<string, PreparedOnboarding>();
  let initializedToolsRegistered = false;
  const registerInitialized = (): void => {
    if (initializedToolsRegistered) return;
    initializedToolsRegistered = true;
    registerInitializedTools(server, cwd, prepared, onboarding, evidence);
  };

  server.registerTool(
    'clad_prepare_init',
    {
      title: 'Prepare Cladding onboarding context',
      description:
        'Non-destructive first step for every explicit Cladding initialization request: writes no authored project ' +
        'files (only a TTL\'d consent cache). Inspect the connected project, ' +
        'then use this tool result to draft the structured input for clad_init. Never run clad init in a shell.',
      inputSchema: z.object({
        mode: z.enum(['idea', 'document', 'existing']),
        intent: z.string().optional(),
        document_path: z.string().optional(),
        refresh: z.boolean().optional(),
      }).strict(),
      outputSchema: {
        status: z.string(), changed: z.boolean(), schemaVersion: z.number().optional(), token: z.string().optional(),
        prompt: z.string().optional(), request: z.object({mode: z.string(), intent: z.string()}).optional(),
        observation: z.record(z.string(), z.unknown()).optional(), question: z.string().optional(), error: z.string().optional(),
        plannedChanges: z.array(z.string()).optional(), confirmationQuestion: z.string().optional(),
        requiresSeparateUserConfirmation: z.boolean().optional(),
        approvalChallenge: z.string().optional(),
      },
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      if (!onboarding) return mcpPayload({status: 'unavailable', changed: false}, true);
      if (existsSync(join(cwd, 'spec.yaml')) && !args.refresh) {
        return mcpPayload({status: 'already_initialized', changed: false});
      }
      let intent = args.intent?.trim() ?? '';
      if (args.mode === 'idea' && !intent) {
        return mcpPayload({status: 'needs_input', changed: false, question: 'What kind of project are you building?'});
      }
      if (args.mode === 'document') {
        const resolved = projectIntentPath(cwd, args.document_path ?? '');
        if (resolved.error) return mcpPayload({status: 'invalid_request', changed: false, error: resolved.error}, true);
        intent = resolved.text!;
      }
      if (args.mode === 'existing' && !intent) intent = 'Adopt Cladding into the observed existing project.';
      const briefing = onboarding.prepareInit({cwd, mode: args.mode, intent});
      const challenge = approvalChallenge();
      const observedSourceCount = Number(briefing.observation.source_file_count ?? 0);
      const request: PreparedOnboarding = {
        kind: 'init', snapshot: onboardingPreparationSnapshot(cwd), mode: args.mode, intent, refresh: args.refresh,
        approvalChallenge: challenge,
        scan: args.mode === 'existing' || observedSourceCount > 0,
      };
      const token = encodePreparedOnboarding(request);
      prepared.set(token, request);
      persistPendingPreparation(cwd, challenge, token, request);
      return mcpPayload({
        status: 'needs_confirmation', changed: false, schemaVersion: 1, token,
        prompt: briefing.prompt, request: briefing.request, observation: briefing.observation,
        plannedChanges: args.refresh
          ? [
              'Preserve authored files and write review proposals under .cladding/scan/.',
              'Propose refreshed docs/project-context.md, spec/architecture.yaml, and spec/capabilities.yaml.',
            ]
          : [
              'Create spec.yaml, spec/architecture.yaml, and spec/capabilities.yaml.',
              'Create 1-3 spec/scenarios/*.yaml journey files.',
              'Create docs/project-context.md and docs/conventions.md.',
              'Create .cladding/onboarding/state.yaml and append the .cladding/* ignore pair (config.yaml stays committable).',
              'Create a managed AGENTS.md block; preserve an existing unmanaged AGENTS.md.',
              'Preserve any existing CLAUDE.md unchanged; AGENTS.md is the shared host instruction surface.',
            ],
        confirmationQuestion: `To apply these changes, reply with the exact approval phrase: ${challenge}`,
        approvalChallenge: challenge,
        requiresSeparateUserConfirmation: true,
      });
    },
  );

  server.registerTool(
    'clad_stage_init',
    {
      title: 'Stage a Cladding onboarding draft for approval',
      description:
        'Validate and temporarily cache the host-model draft from clad_prepare_init before showing the approval phrase. ' +
        'This does not modify project files and lets a later host process apply the exact staged draft.',
      inputSchema: z.object({
        token: z.string().min(1).max(MAX_APPROVAL_ENVELOPE_BYTES),
        draft: hostDraftSchema,
      }).strict(),
      outputSchema: {
        status: z.string(), changed: z.boolean(), approvalChallenge: z.string().optional(),
        confirmationQuestion: z.string().optional(), error: z.string().optional(),
      },
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const request = prepared.get(args.token) ?? decodePreparedOnboarding(args.token);
      if (!request || request.kind !== 'init' || !request.approvalChallenge) {
        return mcpPayload({status: 'invalid_token', changed: false}, true);
      }
      if (request.snapshot !== onboardingPreparationSnapshot(cwd)) {
        return mcpPayload({status: 'stale_preparation', changed: false}, true);
      }
      persistPendingPreparation(cwd, request.approvalChallenge, args.token, request, args.draft);
      return mcpPayload({
        status: 'staged',
        changed: false,
        approvalChallenge: request.approvalChallenge,
        confirmationQuestion: `To apply these changes, reply with the exact approval phrase: ${request.approvalChallenge}`,
      });
    },
  );

  server.registerTool(
    'clad_init',
    {
      title: 'Apply a validated Cladding onboarding draft',
      description:
        'Write Cladding artifacts from the host model draft returned after clad_prepare_init. ' +
        'Use the one-time token when the host retained it; process-per-turn hosts may use the exact approval phrase ' +
        'through the short-lived project runtime cache. Copy the complete user message, including the APPLY CLADDING ' +
        'prefix, into confirmation. Malformed, stale, or replayed requests do not write files.',
      inputSchema: z.object({
        token: z.string().min(1).max(MAX_APPROVAL_ENVELOPE_BYTES).optional(),
        confirmation: z.string().regex(/^APPLY CLADDING [A-F0-9]{6}$/).describe(
          'The complete separate user reply, verbatim, including the APPLY CLADDING prefix',
        ),
        draft: hostDraftSchema.optional(),
      }).strict(),
      outputSchema: {
        status: z.string(), changed: z.boolean(), created: z.array(z.string()).optional(), skipped: z.array(z.string()).optional(),
        language: z.string().optional(), proposals: z.array(z.string()).optional(), clarifyingQuestions: z.array(z.string()).optional(),
        onboardingMode: z.enum(['greenfield', 'existing-adoption', 'mixed']).optional(), onboardingSource: z.string().optional(),
        nextQuestion: z.string().nullable().optional(), remainingQuestions: z.number().optional(), error: z.string().optional(),
        confirmation: z.string().optional(), completionMessage: z.string().optional(),
      },
      annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
    },
    async (args) => {
      const pending = loadPendingPreparation(cwd, args.confirmation.trim());
      const request = (args.token
        ? prepared.get(args.token) ?? decodePreparedOnboarding(args.token)
        : null) ?? pending?.request;
      if (!request || request.kind !== 'init') return mcpPayload({status: 'invalid_token', changed: false}, true);
      if (!request.approvalChallenge || args.confirmation.trim() !== request.approvalChallenge) {
        return mcpPayload({
          status: 'confirmation_required', changed: false,
          error: 'The exact one-time approval phrase shown in the preview is required.',
        }, true);
      }
      if (request.snapshot !== onboardingPreparationSnapshot(cwd)) return mcpPayload({status: 'stale_preparation', changed: false}, true);
      if (!onboarding) return mcpPayload({status: 'unavailable', changed: false}, true);
      const draft = args.draft ?? pending?.draft;
      if (!draft) {
        return mcpPayload({
          status: 'draft_required', changed: false,
          error: 'No staged onboarding draft is available. Prepare and stage the draft again before approval.',
        }, true);
      }
      if (args.token) prepared.delete(args.token);
      removePendingPreparation(cwd, args.confirmation.trim());
      const response = onboarding.renderDraft(draft);
      const rollback = captureOnboardingRollback(cwd);
      let init: Awaited<ReturnType<OnboardingOperations['initialize']>>;
      try {
        init = await onboarding.initialize({
          cwd, intent: request.intent, scan: request.scan ? true : undefined,
          hostDispatcher: async () => response,
        });
      } catch (error) {
        restoreOnboardingRollback(cwd, rollback);
        return mcpPayload({
          status: 'failed', changed: false,
          error: `Initialization failed; all onboarding files were restored: ${(error as Error).message}`,
        }, true);
      }
      const questions = init.clarifyingQuestions ?? [];
      // Structured content the declared output schema does not name is rejected
      // before a host ever sees it, and that schema's size is a measured design
      // budget. The scaffolded schema therefore stays out of the published
      // result: a host reads it from the spec.yaml this approval just wrote.
      const initResult: Record<string, unknown> = {...init};
      delete initResult.schema;
      const payload = {
        status: questions.length > 0 ? 'needs_answers' : 'initialized', changed: true,
        ...initResult,
        onboardingSource: 'host',
        confirmation: args.confirmation,
        nextQuestion: questions[0] ?? null,
        remainingQuestions: questions.length,
        ...(questions.length === 0 ? {completionMessage: onboardingCompletionMessage()} : {}),
      };
      registerInitialized();
      return mcpPayload(payload);
    },
  );

  if (existsSync(join(cwd, 'spec.yaml'))) registerInitialized();
}

/**
 * Keeps ordinary development tool descriptions out of pre-init model context.
 *
 * @see spec/features/natural-language-init-0f4dd6.yaml AC-017
 */
function registerInitializedTools(
  server: McpServer,
  cwd: string,
  prepared: Map<string, PreparedOnboarding>,
  onboarding?: OnboardingOperations,
  evidence?: EvidenceOperations,
): void {
  server.registerTool(
    'clad_prepare_clarify',
    {
      title: 'Prepare the next Cladding onboarding answer',
      description:
        'Use only after a new user message answers the displayed pending question. Pass that answer verbatim. ' +
        'Never call during the initialization approval turn and never invent an answer.',
      inputSchema: z.object({answer: z.string().min(1)}).strict(),
      outputSchema: {
        status: z.string(), changed: z.boolean(), schemaVersion: z.number().optional(), token: z.string().optional(),
        prompt: z.string().optional(), request: z.object({mode: z.string(), intent: z.string()}).optional(),
        observation: z.record(z.string(), z.unknown()).optional(), error: z.string().optional(),
      },
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      if (!onboarding) return mcpPayload({status: 'unavailable', changed: false}, true);
      const briefing = onboarding.prepareClarify(args.answer, {cwd});
      if ('error' in briefing) return mcpPayload({status: 'invalid_state', changed: false, error: briefing.error}, true);
      const request: PreparedOnboarding = {
        kind: 'clarify', snapshot: onboardingPreparationSnapshot(cwd), mode: 'idea', intent: briefing.request.intent, answer: args.answer,
      };
      const token = encodePreparedOnboarding(request);
      prepared.set(token, request);
      persistPendingPreparation(cwd, `clarify:${args.answer}`, token, request);
      return mcpPayload({status: 'needs_host_draft', changed: false, schemaVersion: 1, token, prompt: briefing.prompt, request: briefing.request, observation: briefing.observation});
    },
  );

  server.registerTool(
    'clad_clarify',
    {
      title: 'Answer the next Cladding onboarding question',
      description:
        'Apply a host-model refinement only for an answer supplied in a new user message after the pending question. ' +
        'Never call during the initialization approval turn; do not invent or alter the user answer.',
      inputSchema: z.object({
        answer: z.string().min(1).describe('The user\'s answer, verbatim'),
        token: z.string().min(1).max(MAX_APPROVAL_ENVELOPE_BYTES).optional(),
        draft: hostDraftSchema,
      }).strict(),
      outputSchema: {
        status: z.string(), changed: z.boolean(), cwd: z.string().optional(), answered: z.unknown().optional(),
        newQuestions: z.array(z.string()).optional(), mode: z.enum(['greenfield', 'existing-adoption', 'mixed']).nullable().optional(),
        nextQuestion: z.string().nullable().optional(), remainingQuestions: z.number().optional(), refinementSource: z.string().optional(),
        pendingReview: z.array(z.string()).optional(), completionMessage: z.string().optional(),
        error: z.string().optional(),
      },
      annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
    },
    async (args) => {
      const pending = loadPendingPreparation(cwd, `clarify:${args.answer}`);
      const request = (args.token
        ? prepared.get(args.token) ?? decodePreparedOnboarding(args.token)
        : null) ?? pending?.request;
      if (!request || request.kind !== 'clarify' || request.answer !== args.answer) return mcpPayload({status: 'invalid_token', changed: false}, true);
      if (request.snapshot !== onboardingPreparationSnapshot(cwd)) return mcpPayload({status: 'stale_preparation', changed: false}, true);
      if (!onboarding) return mcpPayload({status: 'unavailable', changed: false}, true);
      if (args.token) prepared.delete(args.token);
      removePendingPreparation(cwd, `clarify:${args.answer}`);
      const response = onboarding.renderDraft(args.draft);
      const outcome = await onboarding.clarify(args.answer, {cwd, hostDispatcher: async () => response});
      if (!outcome.ok) return mcpPayload({status: 'failed', changed: false, error: outcome.error ?? 'onboarding clarification failed'}, true);
      const report = outcome.report;
      const reportPayload: Record<string, unknown> = report !== null
        && typeof report === 'object'
        && !Array.isArray(report)
        ? report as Record<string, unknown>
        : {};
      return mcpPayload({
        ...reportPayload,
        changed: true,
        refinementSource: 'host',
        ...(reportPayload.status === 'done' ? {completionMessage: onboardingCompletionMessage()} : {}),
      });
    },
  );

  server.registerTool(
    'clad_resolve_onboarding_review',
    {
      title: 'Apply reviewed onboarding design proposals',
      description:
        'After showing proposal diffs and receiving explicit user approval, applies only the selected pending proposal targets. ' +
        'Never call this automatically; authored design is preserved until the user reviews it.',
      inputSchema: z.object({
        targets: z.array(z.string()).min(1).describe('Exact active artifact paths returned in pendingReview.'),
      }).strict(),
      annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
    },
    async (args) => {
      if (!onboarding) return mcpPayload({status: 'unavailable', changed: false}, true);
      const result = onboarding.resolveReview(args.targets, {cwd});
      return mcpPayload({
        status: result.status ?? (result.ok ? 'resolved' : 'failed'),
        changed: result.changed,
        remaining: result.remaining,
        ...(result.status === 'done' ? {completionMessage: onboardingCompletionMessage()} : {}),
        error: result.error,
      }, !result.ok);
    },
  );

  // clad_list_features — list features in the active spec.
  // v0.3.10 (F-085) — slug_substring + sort options.
  server.registerTool(
    'clad_list_features',
    {
      title: 'List cladding features',
      description:
        'List features from spec.yaml. Optionally filter by status or slug substring, ' +
        'and sort alphabetically (default) or by recent file mtime.',
      inputSchema: {
        statusFilter: z
          .enum(['planned', 'in_progress', 'done', 'archived'])
          .optional()
          .describe('Limit to features with this status'),
        slugSubstring: z
          .string()
          .optional()
          .describe("Case-insensitive substring match on slug (e.g. 'auth')"),
        sort: z
          .enum(['alphabetical', 'recent'])
          .optional()
          .describe("'alphabetical' (default — by id) or 'recent' (by file mtime, newest first)"),
      },
      annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const loaded = loadSpecOrError(cwd);
      if ('error' in loaded) {
        return {isError: true, content: [{type: 'text', text: loaded.error}]};
      }
      const spec = loaded.spec;
      let filtered = spec.features;
      if (args.statusFilter) {
        filtered = filtered.filter((f) => f.status === args.statusFilter);
      }
      if (args.slugSubstring) {
        const needle = args.slugSubstring.toLowerCase();
        filtered = filtered.filter((f) => {
          const slug = (f as {slug?: string}).slug;
          return slug ? slug.toLowerCase().includes(needle) : false;
        });
      }
      const ordered =
        args.sort === 'recent' ? sortByRecentMtime(filtered, cwd) : filtered;
      const summary = ordered.map((f) => ({
        id: f.id,
        slug: (f as {slug?: string}).slug,
        title: f.title,
        status: f.status,
      }));
      return {
        content: [{type: 'text', text: JSON.stringify({total: summary.length, features: summary}, null, 2)}],
      };
    },
  );

  // clad_get_feature — fetch a single feature by id OR slug (v0.3.10).
  server.registerTool(
    'clad_get_feature',
    {
      title: 'Get a cladding feature',
      description:
        'Returns one feature record by id (e.g. "F-049" or "F-a3f9c2e1") or by slug ' +
        '(e.g. "login-flow"). When a slug matches multiple features, all matches are returned.',
      inputSchema: {
        id: z.string().optional().describe('Feature id such as "F-049" or "F-a3f9c2e1"'),
        slug: z.string().optional().describe("Feature slug such as 'login-flow'"),
      },
      annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      if (!args.id && !args.slug) {
        return {
          isError: true,
          content: [{type: 'text', text: 'provide either id or slug'}],
        };
      }
      const loaded = loadSpecOrError(cwd);
      if ('error' in loaded) {
        return {isError: true, content: [{type: 'text', text: loaded.error}]};
      }
      const matches = loaded.spec.features.filter((f) => {
        if (args.id && f.id === args.id) return true;
        if (args.slug && (f as {slug?: string}).slug === args.slug) return true;
        return false;
      });
      if (matches.length === 0) {
        const lookup = args.id ? `id "${args.id}"` : `slug "${args.slug}"`;
        return {
          isError: true,
          content: [{type: 'text', text: `no feature with ${lookup} found`}],
        };
      }
      // Multiple matches by slug are surfaced as an array; single
      // match (the common case) collapses to the bare feature for
      // backward compatibility with existing tool consumers.
      const payload = matches.length === 1 ? matches[0] : {matches};
      return {
        content: [{type: 'text', text: JSON.stringify(payload, null, 2)}],
      };
    },
  );

  // clad_run_check — run the drift stage, optionally in strict mode.
  server.registerTool(
    'clad_run_check',
    {
      title: 'Run cladding drift check',
      description: 'Runs `clad check` drift detection. Returns a TERSE report by default (pass, error/warn counts, top 3 blocking findings) to keep the agent loop cheap; pass verbose:true for every finding incl. info-severity + suggestions.',
      inputSchema: {
        strict: z.boolean().optional().describe('Treat warnings as errors when true'),
        verbose: z.boolean().optional().describe('Return the full report (all findings incl. info + suggestions) instead of the terse top-3 summary'),
      },
      annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const result = runDrift({strict: args.strict, cwd});
      if (args.verbose) {
        return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}], isError: !result.pass};
      }
      // Terse by default: info-severity findings are advisory noise that re-enters
      // the agent's context every turn; surface only the blocking few + counts.
      const findings = result.findings ?? [];
      const errs = findings.filter((f) => f.severity === 'error');
      const warns = findings.filter((f) => f.severity === 'warn');
      const top = (errs.length > 0 ? errs : warns).slice(0, 3).map((f) => ({
        detector: f.detector,
        severity: f.severity,
        message: f.message,
        ...(f.path ? {path: f.path} : {}),
        ...(f.line ? {line: f.line} : {}),
      }));
      const terse = {
        stage: result.stage,
        pass: result.pass,
        errorCount: errs.length,
        warnCount: warns.length,
        findings: top,
        ...(errs.length + warns.length > top.length ? {truncated: true, hint: 'call clad_run_check with verbose:true for all findings'} : {}),
      };
      return {content: [{type: 'text', text: JSON.stringify(terse, null, 2)}], isError: !result.pass};
    },
  );

  // clad_run_gate (F-570a3f) — run the REAL Iron Law pipeline in-session.
  // Before this, the MCP surface could only run the drift detectors: an
  // agent driving cladding through MCP never executed a single test. The
  // gate runs via the engine's own bin shim in a subprocess — the serve
  // layer must not import the cli layer (topology: cli → serve, never the
  // reverse), and a separate process gives the same pipeline `clad check`
  // and `clad done` use, byte-identical JSON included.
  server.registerTool(
    'clad_run_gate',
    {
      title: 'Run the full Iron Law gate',
      description:
        'Runs the real `clad check` pipeline for a tier (default pre-commit for latency; pre-push runs ' +
        'type/lint/tests/coverage/conformance/smoke) and returns the untruncated JSON outcome. Strict by default — ' +
        'this is the verification surface; use clad_run_check for the cheap drift-only view.',
      inputSchema: {
        tier: z.enum(['pre-commit', 'pre-push', 'all']).optional().describe('Stage tier (default pre-commit)'),
        profile: z.enum(['feedback', 'checkpoint', 'completion', 'push', 'release']).optional().describe('Canonical assurance profile; must match a supplied legacy tier alias'),
        assurance_level: z.enum(['L1', 'L2', 'L3', 'L4']).optional().describe('One-run assurance level; cannot lower persisted policy'),
        strict: z.boolean().optional().describe('Promote warn findings to blocking (default true)'),
      },
    },
    async (args) => {
      const shim = engineShim();
      if (!shim) {
        return {
          isError: true,
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, error: 'cladding engine shim (bin/clad) not found relative to the running server'})}],
        };
      }
      const strict = args.strict !== false;
      const tierProfiles: Readonly<Record<string, string>> = {'pre-commit': 'checkpoint', 'pre-push': 'push', all: 'release'};
      if (args.profile && args.tier && tierProfiles[args.tier] !== args.profile) {
        return {
          isError: true,
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, error: 'The requested profile conflicts with the legacy tier alias.'})}],
        };
      }
      const res = spawnSync(shim, cladRunGateCliArgs({
        tier: args.tier,
        profile: args.profile,
        assuranceLevel: args.assurance_level,
        strict,
      }), {
        cwd,
        encoding: 'utf8',
        timeout: 300_000,
      });
      try {
        const doc = JSON.parse(res.stdout || '') as {worst?: number};
        return {
          isError: (doc.worst ?? 1) !== 0,
          content: [{type: 'text', text: JSON.stringify(cladRunGatePayload(doc), null, 2)}],
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                schema_version: PAYLOAD_SCHEMA_VERSION,
                error: 'gate produced no parseable JSON',
                stderr: (res.stderr ?? '').slice(0, 400),
              }),
            },
          ],
        };
      }
    },
  );

  // clad_verdict (F-2e28cc72) — the loop's earned stop-condition, one poll.
  // SUBSUMES clad_run_gate for the loop: it runs the real pre-push strict gate
  // ONCE and reduces it to a single decision, so a driving agent calls THIS per
  // turn instead of the raw gate. Same subprocess pattern as clad_run_gate (the
  // serve layer must not import the cli layer; a separate process gives the
  // byte-identical pipeline). A poll that answers ITERATE/ESCALATE is a SUCCESS,
  // not a tool error — isError stays false; only an unparseable poll is an error.
  server.registerTool(
    'clad_verdict',
    {
      title: 'Poll the loop verdict',
      description:
        'One-poll loop decision over the real pre-push strict gate + feature statuses. Runs the gate ONCE and ' +
        'reduces it to {verdict, next_action, remaining} — call this INSTEAD OF clad_run_gate per loop turn, not in ' +
        'addition. verdict is one of DONE|ITERATE|ESCALATE|BLOCKED|BOOTSTRAP; DONE requires a green gate AND every ' +
        'feature done AND at least one non-liveness behavioral proof.',
      inputSchema: {
        tier: z.enum(['pre-commit', 'pre-push', 'all']).optional().describe('Gate tier (default pre-push)'),
      },
    },
    async (args) => {
      const shim = engineShim();
      if (!shim) {
        return {
          isError: true,
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, error: 'cladding engine shim (bin/clad) not found relative to the running server'})}],
        };
      }
      const res = spawnSync(shim, ['verdict', '--json', ...(args.tier ? [`--tier=${args.tier}`] : [])], {
        cwd,
        encoding: 'utf8',
        timeout: 300_000,
      });
      try {
        const doc = JSON.parse(res.stdout || '') as Record<string, unknown>;
        return {
          isError: false,
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...doc}, null, 2)}],
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                schema_version: PAYLOAD_SCHEMA_VERSION,
                error: 'verdict produced no parseable JSON',
                stderr: (res.stderr ?? '').slice(0, 400),
              }),
            },
          ],
        };
      }
    },
  );

  // clad_get_context (F-d2c806) — the Least Context principle, mechanized.
  server.registerTool(
    'clad_get_context',
    {
      title: 'Get the context slice for one feature',
      description:
        "Returns the working set for ONE feature in one call: the focus feature (full), its transitive " +
        'depends_on ancestors (title+status), bound scenarios, the matching ai_hints patterns, and the union ' +
        "of the feature's test_refs. Look up by feature id (F-…), slug, or a module path. Prefer this over " +
        'reading shards by hand — dispatch the slice, never the whole spec.',
      inputSchema: {
        query: z.string().describe('Feature id (F-…), slug, or module path (e.g. src/auth/login.ts)'),
      },
    },
    async (args) => {
      try {
        const loaded = loadSpecOrError(cwd);
        if ('error' in loaded) {
          return {isError: true, content: [{type: 'text', text: loaded.error}]};
        }
        const slice = buildContextSlice(loaded.spec, args.query);
        const miss = 'not_found' in slice;
        recordServe(cwd, 'clad_get_context', args.query, !miss);
        return {
          isError: miss,
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...slice}, null, 2)}],
        };
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // clad_get_working_set (F-06dfdad6) — the code-bearing, token-budgeted superset of
  // clad_get_context: focus + module CODE + forward needs + backward breaks + verify + budget,
  // fused in one call. clad_get_context stays frozen for hosts that cache its shape.
  server.registerTool(
    'clad_get_working_set',
    {
      title: 'Get the token-budgeted working set for one feature (code + needs + breaks)',
      description:
        'Returns ONE token-budgeted working set for a feature/module: must_edit (focus + full ACs + the ACTUAL ' +
        'source code of its modules), needs (forward depends_on), breaks_if_changed (direct dependents + the ' +
        'regression test set), verify (scenarios + tests + oracle_refs + EARS unwanted/state high-risk ACs), ' +
        'guidance (ai_hints), and budget (what was clipped to fit). One call replaces reading the shard + opening ' +
        'each module file + grepping deps/tests. Look up by feature id (F-…), slug, or module path.',
      inputSchema: {
        query: z.string().describe('Feature id (F-…), slug, or module path (e.g. src/auth/login.ts)'),
        max_tokens: z
          .number()
          .int()
          .positive()
          .max(20000)
          .optional()
          .describe('Token budget for the payload (default 3000); distant deps then code then tests are clipped to fit'),
      },
    },
    async (args) => {
      try {
        const loaded = loadSpecOrError(cwd);
        if ('error' in loaded) {
          return {isError: true, content: [{type: 'text', text: loaded.error}]};
        }
        const ws = buildWorkingSet(loaded.spec, args.query, {cwd, maxTokens: args.max_tokens, graph: graphIrView(cwd, loaded.spec)});
        const budget = 'not_found' in ws ? null : {truncated: ws.budget.truncated.length > 0, sliceTokens: ws.budget.used_tokens};
        recordServe(cwd, 'clad_get_working_set', args.query, budget !== null, budget ?? undefined);
        return {
          isError: 'not_found' in ws,
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...ws}, null, 2)}],
        };
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // clad_get_impact (F-7794a6bc) — the backward complement of clad_get_context.
  // "What breaks if I change this?" Walks the canonical GraphIR dependents and
  // returns the blast radius: impacted features, scenarios at risk, the
  // regression test set to run, and the modules in the radius.
  server.registerTool(
    'clad_get_impact',
    {
      title: 'Get the blast radius for a change (reverse / impact slice)',
      description:
        "Returns what a change to ONE feature or file could break: the transitive dependents (id+title+status), " +
        'the scenarios bound to any of them, the deduped union of their test_refs (the regression set to re-run), ' +
        'and the modules in the radius. Look up by feature id (F-…), slug, or a module path — a module fans out to ' +
        'ALL features that touch it. The backward complement of clad_get_context: forward = what this needs, ' +
        'impact = what depends on this. Prefer this over grepping to scope a safe refactor.',
      inputSchema: {
        query: z.string().describe('Feature id (F-…), slug, or module path (e.g. src/spec/load.ts)'),
        max_depth: z
          .number()
          .int()
          .positive()
          .max(6)
          .optional()
          .describe('Bound the dependent walk to N hops (default: unbounded — the full transitive radius)'),
      },
    },
    async (args) => {
      try {
        const loaded = loadSpecOrError(cwd);
        if ('error' in loaded) {
          return {isError: true, content: [{type: 'text', text: loaded.error}]};
        }
        const slice = buildImpactSlice(loaded.spec, args.query, {depth: args.max_depth, graph: graphIrView(cwd, loaded.spec)});
        const miss = 'not_found' in slice;
        recordServe(cwd, 'clad_get_impact', args.query, !miss);
        return {
          isError: miss,
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...slice}, null, 2)}],
        };
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // clad_get_graph (F-64a5c159 / F-208eaa79) — the live spec↔code↔doc knowledge
  // graph as a BOUNDED, relation-aware GraphIR projection, or deterministic corpus
  // statistics when no query is given. The whole graph is megabytes on cladding-self
  // and grows with the project, so no request can widen a focused read into a corpus
  // walk: bounds are validated, the payload is measured to a fixed point against the
  // D19 observe ceiling, and an unmatched spelling is an explicit unresolved answer
  // rather than an empty success. Always recomputed from the current spec (never stale).
  server.registerTool(
    'clad_get_graph',
    {
      title: 'Get the live knowledge graph (bounded projection, or corpus statistics)',
      description:
        `Return a bounded GraphIR schema_version ${GRAPH_SCHEMA_VERSION} projection around one query ` +
        '(canonical address, feature id, slug, or repository path) at default depth 1, or corpus ' +
        'statistics when query is omitted. Bounds: max_depth 1-3, max_nodes 1-200, max_edges 1-400; ' +
        'out-of-range bounds and unmatched queries answer with an explicit error. ' +
        'skill nodes and graph taxonomy: docs/knowledge-graph/design.md.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Seed node: canonical address, feature id (F-…), slug, or repository path. Omit for corpus statistics.'),
        // The wire owns every semantic bound so an out-of-range request returns a
        // `rejected` envelope naming its reason, not an opaque protocol error.
        max_depth: z.number().int().optional().describe('Relation hops from the seed, 1 to 3 (default: 1)'),
        max_nodes: z.number().int().optional().describe('Maximum materialized nodes, 1 to 200 (default: 64)'),
        max_edges: z.number().int().optional().describe('Maximum materialized edges, 1 to 400 (default: 128)'),
      },
    },
    async (args) => {
      let workspace;
      try {
        workspace = loadGraphIrV2Workspace(cwd);
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `cladding: graph not loaded — ${(err as Error).message}. Run \`clad init\` to scaffold spec.yaml first.`,
            },
          ],
        };
      }
      try {
        if (!args.query) {
          return {content: [{type: 'text', text: graphPayload(statisticsV2(workspace))}]};
        }
        const envelope = focusedProjectionV2(workspace, {
          query: args.query,
          ...(args.max_depth === undefined ? {} : {max_depth: args.max_depth}),
          ...(args.max_nodes === undefined ? {} : {max_nodes: args.max_nodes}),
          ...(args.max_edges === undefined ? {} : {max_edges: args.max_edges}),
        });
        const text = graphPayload(envelope);
        // A non-answer is an error result carrying the SAME envelope: the caller
        // reads why it failed and which spellings resolve, never an empty success.
        return envelope.kind === 'projection'
          ? {content: [{type: 'text', text}]}
          : {isError: true, content: [{type: 'text', text}]};
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // clad_changelog (F-904495a5) — the spec rendered into a shipped-changes
  // manifest. The deterministic collector/renderers live in src/changelog/;
  // the LLM host renders the human prose FROM the manifest, never from memory.
  server.registerTool(
    'clad_changelog',
    {
      title: 'Collect shipped changes since a git ref (changelog manifest)',
      description:
        'Collect a deterministic shipped-changes manifest for <since>..HEAD (latest tag by default). ' +
        'Formats and release-note guidance: skills/changelog/SKILL.md.',
      inputSchema: {
        since: z
          .string()
          .optional()
          .describe('Git ref to diff from (default: latest tag via `git describe --tags --abbrev=0`)'),
        format: z
          .enum(['manifest', 'markdown', 'catalog', 'audit'])
          .optional()
          .describe("Payload format (default 'manifest')"),
      },
    },
    async (args) => {
      try {
        const format = args.format ?? 'manifest';
        if (format === 'catalog') {
          const content = renderCatalog(loadSpec(cwd));
          return {
            content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, format, content}, null, 2)}],
          };
        }
        const since = args.since ?? defaultSinceRef(cwd);
        const manifest = collectChangelog(cwd, since);
        if (format === 'manifest') {
          return {
            content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...manifest}, null, 2)}],
          };
        }
        const content =
          format === 'audit'
            ? renderAuditTable(manifest, loadSpec(cwd), cwd)
            : renderChangelogMarkdown(manifest);
        return {
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, format, content}, null, 2)}],
        };
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // clad_get_events — return the last N events from .cladding/events.log.
  server.registerTool(
    'clad_get_events',
    {
      title: 'Get recent cladding events',
      description: 'Reads .cladding/events.log and returns the most recent entries.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe('Maximum entries to return (default 50)'),
      },
      outputSchema: {
        ok: z.boolean(), code: z.string(), message: z.string(), events: z.array(z.unknown()).optional(),
        omitted_events: z.number().int().nonnegative().optional(), oversized_events: z.number().int().nonnegative().optional(),
        byte_limit: z.literal(EVENT_RESPONSE_BYTE_LIMIT).optional(),
      },
      annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const limit = args.limit ?? 50;
      try {
        return withSpecWorkspaceLock(cwd, () => boundedEventMcpPayload(recentEventProjection(cwd, limit)));
      } catch (error) {
        const typed = error as SpecEditError;
        const message = `Event history is temporarily unavailable: ${typed.message}`.slice(0, 2048);
        return boundedEventMcpPayload({ok: false, code: typed.code ?? 'EVENT_UNAVAILABLE', message, byte_limit: EVENT_RESPONSE_BYTE_LIMIT}, true);
      }
    },
  );

  server.registerTool(
    'clad_prepare_spec_edit',
    {
      title: 'Prepare a typed specification edit',
      description: 'Returns a projection revision and the canonical input revisions required for one typed operation batch; it never writes.',
      inputSchema: z.object({operations: typedSpecEditOperationsSchema}).strict(),
      outputSchema: {ok: z.boolean(), code: z.string(), message: z.string(), context_revision: z.string().regex(SHA256_DIGEST).optional(), input_revisions: z.record(z.string().max(256), z.string().regex(SHA256_DIGEST)).optional()},
      annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      try {
        const result = prepareSpecEdit(cwd, args.operations);
        return mcpPayload({ok: true, code: 'OK', message: 'The typed edit is ready to apply.', context_revision: result.contextRevision, input_revisions: result.inputRevisions});
      } catch (error) {
        const typed = error as SpecEditError;
        return mcpPayload({ok: false, code: typed.code ?? 'INVALID_OPERATION', message: typed.message}, true);
      }
    },
  );

  server.registerTool(
    'clad_edit_spec',
    {
      title: 'Edit the specification through typed operations',
      description:
        'Applies a typed specification-operation batch with the supplied canonical input revisions. ' +
        'This is not a file editor and does not accept JSON Patch paths; the operation registry owns every write set.',
      inputSchema: z.object({
        operations: typedSpecEditOperationsSchema,
        input_revisions: z.record(z.string().max(256), z.string().regex(SHA256_DIGEST)),
        context_revision: z.string().regex(SHA256_DIGEST).optional(),
      }).strict(),
      outputSchema: {ok: z.boolean(), code: z.string(), message: z.string(), changed: z.boolean().optional(), inputRevisions: z.record(z.string().max(256), z.string().regex(SHA256_DIGEST)).optional(), contextRevision: z.string().regex(SHA256_DIGEST).optional(), checkpointedFeatures: z.array(z.string()).optional()},
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      try {
        const result = editSpec({
          cwd,
          operations: args.operations as unknown as readonly SpecEditOperation[],
          inputRevisions: args.input_revisions,
          contextRevision: args.context_revision,
        });
        return mcpPayload({ok: true, code: 'OK', message: result.changed ? 'The specification was updated.' : 'The specification already matched the requested edit.', ...result});
      } catch (error) {
        const typed = error as SpecEditError;
        const message = typed.code === 'BUSY' ? 'The specification is being updated by another task. Try again shortly.' : typed.message;
        return mcpPayload({ok: false, code: typed.code ?? 'INVALID_OPERATION', message}, true);
      }
    },
  );

  server.registerTool(
    'clad_begin',
    {
      title: 'Start an implementation cycle',
      description: 'Starts a feature cycle through feature.begin, saving its one pre-cycle checkpoint and derived inventory together.',
      inputSchema: z.object({feature: z.string()}).strict(),
      outputSchema: {ok: z.boolean(), code: z.string(), message: z.string(), changed: z.boolean().optional(), checkpointedFeatures: z.array(z.string()).optional(), inputRevisions: z.record(z.string().max(256), z.string().regex(SHA256_DIGEST)).optional(), contextRevision: z.string().regex(SHA256_DIGEST).optional()},
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      const operation = {kind: 'feature.begin' as const, featureId: args.feature};
      try {
        const result = editSpec({cwd, operations: [operation], inputRevisions: readSpecEditRevisions(cwd, [operation])});
        return mcpPayload({ok: true, code: 'OK', message: result.changed ? 'The implementation cycle has started.' : 'The implementation cycle was already active.', ...result});
      } catch (error) {
        const typed = error as SpecEditError;
        return mcpPayload({ok: false, code: typed.code ?? 'INVALID_OPERATION', message: typed.message}, true);
      }
    },
  );

  // clad_create_feature — issue a new sharded feature file under
  // spec/features/<slug>-<hash8>.yaml with a content-hash id (v0.3.9, F-084).
  // Host LLM invokes this when the user asks for a new feature in
  // natural language; cladding has no `clad spec new` CLI verb by design.
  server.registerTool(
    'clad_create_feature',
    {
      title: 'Create a new cladding feature',
      description:
        'Create one feature shard from its structured fields, including acceptance criteria and modules. ' +
        'Identifier and concurrent-authoring guidance: docs/spec-ids-multi-dev.md.',
      inputSchema: z.object({
        slug: z
          .string()
          .regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/)
          .describe(
            "Kebab-case slug — filename + spec.slug field (e.g. 'login-flow')",
          ),
        title: z.string().optional().describe('Optional human-readable title; defaults to slug'),
        purpose: z.string().optional().describe('Required WHY statement when the workspace uses schema 0.2.'),
        status: z
          .enum(['planned', 'in_progress', 'done', 'blocked', 'archived'])
          .optional()
          .describe("Optional status; defaults to 'planned'"),
        modules: z
          .array(z.string())
          .optional()
          .describe('Module paths the feature binds to (e.g. ["src/auth/login.ts"]).'),
        capability_refs: z.array(z.string()).optional().describe('Explicit schema 0.2 capability links; use [] for direct project contribution.'),
        acceptance_criteria: z
          .array(
            z.object({
              kind: z.enum(['behavior', 'quality', 'constraint']).optional(),
              statement: z.string().optional().describe('Strict schema 0.2 EARS statement.'),
              ears: z.enum(['ubiquitous', 'event', 'state', 'optional', 'unwanted', 'complex']).optional(),
              text: z.string().optional().describe('The "The system shall …" statement.'),
              action: z.string().optional(),
              response: z.string().optional(),
              condition: z.string().optional().describe('Trigger/precondition for event/state EARS.'),
              test_refs: z.array(z.string()).optional().describe('Paths to verifying tests.'),
              rationale: z.string().optional(),
              constraint_refs: z.array(z.string()).optional(),
              oracle_refs: z.array(z.string()).optional(),
              evidence_refs: z.array(z.string()).optional(),
              notes: z.string().optional(),
            }).strict(),
          )
          .optional()
          .describe(
            'Acceptance criteria authored now receive automatic identifiers. Strongly ' +
              'preferred over an empty feature — this is what makes the feature governable.',
          ),
        design_impact: z.discriminatedUnion('classification', [
          z.object({
            classification: z.literal('none'),
            rationale: z.string().min(1),
          }).strict(),
          z.object({
            classification: z.literal('additive'),
            rationale: z.string().min(1),
            capability: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/),
            // Required only when the selector names a capability that does
            // not already exist. Existing records are linked, never rebuilt
            // from a duplicated caller payload.
            capability_title: z.string().min(1).optional(),
            capability_outcome: z.string().min(1).optional(),
            scenario: z.string().min(1).optional(),
            scenario_definition: z.object({
              id: z.string(), slug: z.string(), title: z.string(), actor: z.string(), goal: z.string(), success: z.string(), steps: z.array(z.string()), feature_refs: z.array(z.string()).optional(),
            }).strict().optional().describe('Schema 0.2 only: full record required when the additive scenario selector is new.'),
          }).strict(),
          z.object({
            classification: z.literal('structural'),
            rationale: z.string().min(1),
            artifacts: z.array(z.string().regex(
              /^docs\/design\/(?:(?!\.{1,2}\/)[^/]+\/)*[^/]+\.md$/,
              'Structural design artifacts must be registered docs/design/**/*.md documents.',
            )).min(1),
          }).strict(),
        ]).optional().describe(
          'Optional design-impact decision. Omit for the legacy-compatible create-only path; ' +
            'structural changes remain review_required until resolved.',
        ),
      }).strict(),
      outputSchema: createFeatureOutputSchema,
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      // Schema 0.2 has one write authority. Keep this legacy convenience
      // adapter deliberately narrow rather than composing create/link/sync
      // transactions around it; richer cross-domain authoring uses clad_edit_spec.
      if (requiredRootSchema(cwd) === '0.2') {
        if (args.status !== undefined && args.status !== 'planned') {
          return mutationPayload({code: 'INVALID_OPERATION', message: 'New schema 0.2 features start planned; begin or archive them with a typed lifecycle operation.'}, true);
        }
        if (!args.purpose?.trim() || args.capability_refs === undefined) {
          return mutationPayload({code: 'INVALID_OPERATION', message: 'A schema 0.2 feature needs a purpose and an explicit capability link list.'}, true);
        }
        if ((args.acceptance_criteria ?? []).some((criterion) => criterion.text !== undefined || criterion.ears !== undefined || criterion.condition !== undefined || criterion.action !== undefined || criterion.response !== undefined || criterion.test_refs !== undefined)) {
          return mutationPayload({code: 'INVALID_OPERATION', message: 'Schema 0.2 criteria use kind and strict statement; legacy EARS and test-reference fields are not accepted.'}, true);
        }
        try {
          const snapshot = readSchema02AuthoringSnapshot(cwd);
          const id = generateFeatureId(args.slug);
          const criteria = (args.acceptance_criteria ?? []).map((criterion, index) => {
            if (!criterion.kind || !criterion.statement?.trim()) throw new Error(`Criterion ${index + 1} needs kind and a strict statement.`);
            return {
              id: `AC-${createHash('sha256').update(`${id}|${index}|${criterion.statement}|${process.hrtime.bigint()}`).digest('hex').slice(0, 8)}`,
              kind: criterion.kind, statement: criterion.statement, rationale: criterion.rationale, constraintRefs: criterion.constraint_refs,
              oracleRefs: criterion.oracle_refs, evidenceRefs: criterion.evidence_refs, notes: criterion.notes,
            };
          });
          const additive = args.design_impact?.classification === 'additive' ? args.design_impact : undefined;
          const capabilityRefs = additive ? [...new Set([...args.capability_refs, additive.capability])] : args.capability_refs;
          const operations: SpecEditOperation[] = [{kind: 'feature.create', id, slug: args.slug, title: args.title ?? args.slug, purpose: args.purpose, modules: args.modules, capabilityRefs, criteria}];
          let catalogBytes: string | undefined;
          let scenarioBinding: {readonly id: string; readonly bytes: string} | undefined;
          if (additive) {
            // The convenience adapter may read authored records, but turns
            // those reads into no-op upserts so their canonical regions are
            // part of the same optimistic transaction precondition.
            catalogBytes = snapshot.capabilityCatalog.sourceBytes;
            const existingCapability = snapshot.capabilities.find((capability) => capability.id === additive.capability);
            if (existingCapability) {
              if ((additive.capability_title !== undefined && additive.capability_title !== existingCapability.title)
                || (additive.capability_outcome !== undefined && additive.capability_outcome !== existingCapability.outcome)) {
                throw new Error(`Existing capability '${additive.capability}' must not be redefined by an additive feature request.`);
              }
              operations.push({kind: 'capability.upsert', capability: {id: additive.capability, title: existingCapability.title, outcome: existingCapability.outcome}});
            } else {
              if (!additive.capability_title || !additive.capability_outcome) throw new Error(`New capability '${additive.capability}' needs a title and outcome.`);
              operations.push({kind: 'capability.upsert', capability: {id: additive.capability, title: additive.capability_title, outcome: additive.capability_outcome}});
            }
            if (additive.scenario) {
              const existing = snapshot.scenarios.find((scenario) =>
                scenario.id === additive.scenario || scenario.slug === additive.scenario);
              if (existing) {
                if (additive.scenario_definition !== undefined) throw new Error(`Existing scenario '${additive.scenario}' must not be redefined by an additive feature request.`);
                scenarioBinding = {id: existing.id, bytes: existing.sourceBytes};
                operations.push({kind: 'scenario.upsert', scenario: {
                  id: existing.id, slug: existing.slug, title: existing.title, actor: existing.actor, goal: existing.goal, success: existing.success,
                  steps: existing.steps, featureRefs: [...new Set([...existing.featureRefs, id])],
                }});
              } else {
                if (!additive.scenario_definition) throw new Error(`New additive scenario '${additive.scenario}' needs a full typed scenario definition.`);
                const definition = additive.scenario_definition;
                if (additive.scenario !== definition.id && additive.scenario !== definition.slug) throw new Error('The additive scenario selector must match the supplied scenario id or slug.');
                scenarioBinding = {id: definition.id, bytes: '<cladding:absent>'};
                operations.push({kind: 'scenario.upsert', scenario: {
                  id: definition.id, slug: definition.slug, title: definition.title, actor: definition.actor, goal: definition.goal, success: definition.success, steps: definition.steps,
                  featureRefs: [...new Set([...(definition.feature_refs ?? []), id])],
                }});
              }
            }
          }
          if (args.design_impact) operations.push({kind: 'feature.set_design_impact', featureId: id, designImpact: {classification: args.design_impact.classification, rationale: args.design_impact.rationale, ...(args.design_impact.classification === 'structural' ? {artifacts: args.design_impact.artifacts, status: 'review_required' as const} : {})}});
          const inputRevisions = readSpecEditRevisions(cwd, operations);
          const digest = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
          if (catalogBytes !== undefined && inputRevisions.capabilities !== digest(catalogBytes)) {
            throw new SpecEditError('STALE_INPUT', 'The capability catalog changed while the additive feature request was being prepared.');
          }
          if (scenarioBinding && inputRevisions[`scenario:${scenarioBinding.id}`] !== digest(scenarioBinding.bytes)) {
            throw new SpecEditError('STALE_INPUT', 'The scenario changed while the additive feature request was being prepared.');
          }
          const result = editSpec({cwd, operations, inputRevisions});
          return mutationPayload({schema_version: PAYLOAD_SCHEMA_VERSION, id, slug: args.slug, path: join(cwd, 'spec', 'features', `${args.slug}-${id.slice(2)}.yaml`), ...result, gate: gateFooter(cwd), message: 'The feature was created.'});
        } catch (error) {
          const typed = error as SpecEditError;
          return mutationPayload({code: typed.code ?? 'INVALID_OPERATION', message: typed.message}, true);
        }
      }
      try {
        if (args.design_impact?.classification === 'additive' && args.design_impact.scenario_definition !== undefined) {
          throw new Error('A full additive scenario_definition is supported only by schema 0.2; schema 0.1 may link an existing scenario selector.');
        }
        const result = createSchema01FeatureComposite({
          slug: args.slug,
          title: args.title,
          purpose: args.purpose,
          status: args.status,
          modules: args.modules,
          capability_refs: args.capability_refs,
          acceptance_criteria: args.acceptance_criteria,
          design_impact: args.design_impact
            ? {
                classification: args.design_impact.classification,
                rationale: args.design_impact.rationale,
                artifacts: args.design_impact.classification === 'structural'
                  ? args.design_impact.artifacts
                  : undefined,
              }
            : undefined,
          cwd,
          ...(args.design_impact?.classification === 'additive' ? {
            additive: {
              capability: args.design_impact.capability,
              ...(args.design_impact.capability_title ? {capabilityTitle: args.design_impact.capability_title} : {}),
              ...(args.design_impact.capability_outcome ? {capabilitySummary: args.design_impact.capability_outcome} : {}),
              ...(args.design_impact.scenario ? {scenario: args.design_impact.scenario} : {}),
            },
          } : {}),
        });
        // Non-mutating firing-path nudge: travels as a `hint` FIELD (keeps the
        // payload valid JSON), never a silent write to capabilities.yaml.
        const designImpact = args.design_impact;
        const withHint = {
          schema_version: PAYLOAD_SCHEMA_VERSION,
          ...result,
          gate: gateFooter(cwd),
          ...(designImpact
            ? {
                designImpact: designImpact.classification === 'structural'
                  ? {
                      status: 'review_required',
                      artifacts: designImpact.artifacts,
                      next: 'Preview and apply the listed Tier-B design changes, then call clad_resolve_design_impact.',
                    }
                  : {status: 'resolved', classification: designImpact.classification},
              }
            : {
                hint:
                  'If this feature is user-facing, link it to a capability with clad_link_capability ' +
                  `(capability: <kebab-id>, feature: ${result.id}) so the Tier-B design SSoT grows with ` +
                  'development instead of being left an empty seed.',
              }),
        };
        return mutationPayload({...withHint, message: 'The feature was created.'});
      } catch (err) {
        const typed = err as SpecEditError;
        return mutationPayload({code: typed.code ?? 'INVALID_OPERATION', message: typed.message}, true);
      }
    },
  );

  server.registerTool(
    'clad_resolve_design_impact',
    {
      title: 'Resolve a reviewed structural design impact',
      description:
        'Marks a feature structural design impact resolved only after the user-approved Tier-B changes have been applied. ' +
        'Do not call this merely to clear the gate; verify every artifact listed in the feature first.',
      inputSchema: z.object({
        feature: z.string().describe('Feature id whose listed Tier-B design changes are now applied.'),
      }).strict(),
      outputSchema: designImpactOutputSchema,
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      try {
        const result = resolveDesignImpact({feature: args.feature, cwd});
        return mutationPayload({schema_version: PAYLOAD_SCHEMA_VERSION, ...result, gate: gateFooter(cwd), message: 'The design impact was resolved.'});
      } catch (error) {
        const typed = error as SpecEditError;
        return mutationPayload({code: typed.code ?? 'INVALID_OPERATION', message: typed.message}, true);
      }
    },
  );

  // clad_author_oracle — record a host-authored impl-blind oracle + its
  // provenance (Phase 2). cladding authors NO LLM call: the host runs
  // `clad oracle` for the spec-only brief, dispatches a blind sub-agent, then
  // records the result here so the SPEC_CONFORMANCE gate can audit it.
  server.registerTool(
    'clad_author_oracle',
    {
      title: 'Record an impl-blind spec-conformance oracle',
      description:
        'Records a host-authored conformance oracle for a feature AC + its impl-blind PROVENANCE, writes the test ' +
        'under tests/oracle/, and stamps oracle_refs so the SPEC_CONFORMANCE gate verifies it. cladding does NOT ' +
        'author the oracle. AUTHOR ONLY ACs on the policy worklist (`clad oracle --required`) — an empty worklist means do not author unless the user explicitly asks (out-of-policy recordings are labeled voluntary). FIRST run `clad oracle <featureId> --ac <acId>` for the spec-only brief; spawn a FRESH ' +
        'sub-agent given ONLY that brief (never the implementation); have it write the test; then call this with the ' +
        'body + the manifest of exactly what the sub-agent saw. Blindness is your discipline — the gate audits the ' +
        'manifest (manifest∩modules must be empty) and the author≠implementer identity, and records whether you ' +
        'attested a clean (blind) context.',
      inputSchema: z.object({
        featureId: z.string().describe(`The feature identifier. ${idPolicyDescription('feature')}`),
        acId: z.string().describe('The AC-<id> the oracle verifies.'),
        body: z.string().describe('The authored vitest oracle source (imports the module under test).'),
        readManifest: z
          .array(z.string())
          .describe('EXACTLY what the blind sub-agent was shown (the clad oracle brief: spec/AC + signatures). MUST NOT include an implementation file the feature owns.'),
        blind: z.boolean().optional().describe('True only if the sub-agent saw the spec-only brief and nothing else.'),
        authorName: z.string().optional().describe('Oracle author identity (sub-agent / model id) — must differ from the implementer for the gate to pass.'),
      }).strict(),
      outputSchema: oracleOutputSchema,
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      try {
        const result = recordOracle({
          featureId: args.featureId,
          acId: args.acId,
          body: args.body,
          readManifest: args.readManifest,
          blind: args.blind,
          authorName: args.authorName,
          cwd,
        });
        // A proof-reference stamp does not affect inventory. In schema 0.2 it
        // is already journaled by criterion.set_proof_refs; do not follow it
        // with an independent derived writer.
        // F-551a1c — the policy must bind BEHAVIOR, not just the gate: the
        // 0.6.0 A/B measured 42-52% of output tokens going to VOLUNTARY
        // exhaustive authoring under a no-mandate policy. Out-of-policy
        // recording stays allowed (extra verification is never forbidden) but
        // is labeled, so the spend is informed.
        let voluntary: {voluntary: true; cost_note: string} | Record<string, never> = {};
        try {
          const spec = loadSpec(cwd);
          const policy = resolveOraclePolicy(spec.project, doneFeatureCount(spec));
          const feature = spec.features.find((f) => f.id === args.featureId);
          const ac = feature?.acceptance_criteria?.find((a) => a.id === args.acId);
          if (!ac || !oracleRequired(policy, args.featureId, ac)) {
            voluntary = {
              voluntary: true,
              cost_note:
                "this AC is not on the project's oracle worklist (`clad oracle --required`) — recording anyway as voluntary; prefer policy-listed ACs to keep token spend inside the declared verification budget.",
            };
          }
        } catch {
          /* unreadable spec → skip the label, never the recording */
        }
        return mutationPayload({schema_version: PAYLOAD_SCHEMA_VERSION, ...result, ...voluntary, gate: gateFooter(cwd), message: result.ok ? 'The oracle was recorded.' : 'The oracle could not be recorded.'}, !result.ok);
      } catch (err) {
        const typed = err as SpecEditError;
        return mutationPayload({code: typed.code ?? 'INVALID_OPERATION', message: typed.message}, true);
      }
    },
  );

  // clad_create_scenario — issue a new sharded scenario file under
  // spec/scenarios/<slug>-<hash8>.yaml (v0.3.12, F-087). Same
  // multi-developer safety story as clad_create_feature.
  server.registerTool(
    'clad_create_scenario',
    {
      title: 'Create a new cladding scenario',
      description:
        'Creates one separately named scenario shard with an automatically assigned collision-safe identifier. ' +
        'Same multi-dev safety property as clad_create_feature: two concurrent invocations on ' +
        'separate branches produce distinct hash ids by construction.',
      inputSchema: z.object({
        slug: z
          .string()
          .regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/)
          .describe("Kebab-case slug (e.g. 'checkout-happy-path')"),
        title: z.string().optional().describe('Optional human-readable title; defaults to slug'),
        flow: z
          .string()
          .optional()
          .describe('Prose user-journey flow (what the user does, step by step).'),
        actor: z.string().optional().describe('Required scenario actor in schema 0.2.'),
        goal: z.string().optional().describe('Required scenario goal in schema 0.2.'),
        success: z.string().optional().describe('Required scenario success state in schema 0.2.'),
        steps: z.array(z.string()).optional().describe('Required ordered scenario steps in schema 0.2.'),
        features: z
          .array(z.string().regex(readableIdPattern('feature')))
          .optional()
          .describe(`Optional list of feature identifiers the scenario touches. ${idPolicyDescription('feature')}`),
      }).strict(),
      outputSchema: scenarioOutputSchema,
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      try {
        const result = createScenario({
          slug: args.slug,
          title: args.title,
          flow: args.flow,
          actor: args.actor,
          goal: args.goal,
          success: args.success,
          steps: args.steps,
          features: args.features,
          cwd,
        });
        return mutationPayload({schema_version: PAYLOAD_SCHEMA_VERSION, ...result, gate: gateFooter(cwd), message: 'The scenario was created.'});
      } catch (err) {
        const typed = err as SpecEditError;
        return mutationPayload({code: typed.code ?? 'INVALID_OPERATION', message: typed.message}, true);
      }
    },
  );

  // clad_link_capability — UPSERT a feature↔capability link into
  // spec/capabilities.yaml (v0.4.x). A capability is accumulative, so the verb
  // is `link` (ensure-and-add), NOT `create`: it creates the capability if it
  // does not exist yet and otherwise appends the feature to its features[]. This
  // is the deterministic development-time firing path for the Tier-B design SSoT.
  server.registerTool(
    'clad_link_capability',
    {
      title: 'Link a feature to a capability',
      description:
        'Upserts a feature into spec/capabilities.yaml: creates the capability if absent, else ' +
        'appends the feature to its features[] (deduped). A capability is ACCUMULATIVE, so the verb ' +
        'is link, not create. Use this when a user-facing feature lands so the design tier grows ' +
        'with development instead of being left an empty seed.',
      inputSchema: z.object({
        capability: z
          .string()
          .regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/)
          .describe("Capability id (kebab-slug, e.g. 'auth'). Created if it does not exist yet."),
        feature: z
          .string()
          .regex(readableIdPattern('feature'))
          .describe(`Feature identifier to add to the capability. ${idPolicyDescription('feature')}`),
        title: z.string().optional().describe('Title, used only when the capability is newly created'),
        summary: z.string().optional().describe('Summary, used only when newly created'),
        surface: z
          .enum(['feature', 'platform', 'tool', 'infrastructure'])
          .optional()
          .describe('Surface, used only when newly created'),
      }).strict(),
      outputSchema: capabilityLinkOutputSchema,
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      try {
        const result = linkCapability({
          capability: args.capability,
          feature: args.feature,
          title: args.title,
          summary: args.summary,
          surface: args.surface,
          cwd,
        });
        return mutationPayload({schema_version: PAYLOAD_SCHEMA_VERSION, ...result, gate: gateFooter(cwd), message: 'The capability link was saved.'});
      } catch (err) {
        const typed = err as SpecEditError;
        return mutationPayload({code: typed.code ?? 'INVALID_OPERATION', message: typed.message}, true);
      }
    },
  );

  server.registerTool(
    'clad_ingest_receipt',
    {
      title: 'Ingest a portable evidence receipt',
      description: 'Validates and create-only stores one signed portable receipt. Trust and expected digest context come from the registered host, never tool input.',
      inputSchema: z.object({receipt_yaml: z.string().min(1)}).strict(),
      outputSchema: {
        ...mutationOutputSchema,
        path: z.string().optional(), digest: z.string().optional(), idempotent: z.boolean().optional(),
        verification: z.object({assurance: z.enum(['verified', 'asserted', 'invalid']), currentness: z.enum(['current', 'stale', 'unresolved']), reason: z.string(), trustSnapshotDigest: z.string()}).optional(),
      },
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      let receipt: PortableReceipt;
      try { receipt = parsePortableReceiptYaml(args.receipt_yaml); } catch (error) {
        return mutationPayload({code: 'INVALID_RECEIPT', message: (error as Error).message}, true);
      }
      const result = ingestPortableReceipt({
        cwd,
        receiptYaml: args.receipt_yaml,
        trustSnapshot: evidence?.trustSnapshot ?? emptyTrustSnapshot(),
        expected: evidence?.expectedDigestContext?.(receipt),
      });
      return mutationPayload({...result, message: result.message}, !result.ok);
    },
  );

  server.registerTool(
    'clad_signoff',
    {
      title: 'Record an asserted local signoff',
      description: 'Records asserted audit or UAT history only. It cannot select or bypass verified evidence.',
      inputSchema: z.object({
        feature: z.string(), claim: z.enum(['audit', 'uat']), criterion: z.string().optional(),
        result: z.enum(['pass', 'fail']).optional(), note: z.string().max(4096).optional(),
      }).strict(),
      outputSchema: {...mutationOutputSchema, evidence: z.record(z.string(), z.unknown()).optional()},
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false},
    },
    async (args) => {
      const oversized = oversizedMutationRequest(args);
      if (oversized) return oversized;
      const boundary = initializedMutationBoundary(cwd);
      if (boundary) return boundary;
      const result = recordAssertedSignoff({
        cwd, featureId: args.feature, claim: args.claim,
        ...(args.criterion ? {criterion: args.criterion} : {}),
        ...(args.result ? {result: args.result} : {}),
        ...(args.note ? {note: args.note} : {}),
      });
      return mutationPayload({...result, ...(result.evidence ? {evidence: result.evidence as unknown as Record<string, unknown>} : {})}, !result.ok);
    },
  );
}

/**
 * Sorts features by the mtime of their backing yaml file under
 * `spec/features/`, newest first. Used by `clad_list_features` when
 * the caller requests `sort: 'recent'` to answer "what did we touch
 * most recently". Features whose backing file cannot be located
 * (e.g. unsharded inline definition) sink to the end with mtime 0.
 *
 * Filename resolution checks both layouts:
 * - new model: `<slug>-<hash8>.yaml`
 * - legacy: `<id>.yaml`
 */
function sortByRecentMtime<T extends {id: string}>(features: readonly T[], cwd: string): T[] {
  const featuresDir = join(cwd, 'spec', 'features');
  const withMtime = features.map((f) => {
    const slug = (f as T & {slug?: string}).slug;
    const candidates = [
      slug ? join(featuresDir, `${slug}-${f.id.slice(2)}.yaml`) : null,
      join(featuresDir, `${f.id}.yaml`),
    ].filter((p): p is string => p !== null);
    let mtime = 0;
    for (const path of candidates) {
      try {
        if (existsSync(path)) {
          mtime = statSync(path).mtimeMs;
          break;
        }
      } catch {
        // fall through — try next candidate
      }
    }
    return {feature: f, mtime};
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.map((x) => x.feature);
}

function registerResources(server: McpServer, cwd: string): void {
  // cladding://spec — the project's spec.yaml (aggregate form, not
  // sharded). Sharded users read via clad_list_features /
  // clad_get_feature, which already do the aggregation.
  server.registerResource(
    'spec',
    RESOURCE_URIS.spec,
    {
      title: 'Cladding spec',
      description: 'The active spec.yaml — aggregated when sharded.',
      mimeType: 'application/json',
    },
    async () => {
      const loaded = loadSpecOrError(cwd);
      // Resources have no isError channel — surface the reason in the JSON body
      // so a client reading cladding://spec on an uninitialised project gets an
      // explanatory payload instead of a crashed read.
      const text =
        'error' in loaded
          ? JSON.stringify({error: loaded.error}, null, 2)
          : JSON.stringify(loaded.spec, null, 2);
      return {
        contents: [
          {
            uri: RESOURCE_URIS.spec,
            mimeType: 'application/json',
            text,
          },
        ],
      };
    },
  );

  // cladding://events — the same bounded, recovered projection as clad_get_events.
  server.registerResource(
    'events',
    RESOURCE_URIS.events,
    {
      title: 'Cladding events log',
      description: 'Bounded recent event projection with the same recovery boundary as clad_get_events.',
      mimeType: 'application/json',
    },
    async () => {
      try {
        const payload = withSpecWorkspaceLock(cwd, () => recentEventProjection(cwd, 50));
        let text = JSON.stringify(payload, null, 2);
        if (Buffer.byteLength(JSON.stringify({contents: [{uri: RESOURCE_URIS.events, mimeType: 'application/json', text}]})) > EVENT_RESPONSE_BYTE_LIMIT) {
          text = JSON.stringify({ok: false, code: 'EVENT_RESPONSE_TOO_LARGE', message: 'Event history could not fit in the response limit.', byte_limit: EVENT_RESPONSE_BYTE_LIMIT});
        }
        return {contents: [{uri: RESOURCE_URIS.events, mimeType: 'application/json', text}]};
      } catch (error) {
        const typed = error as SpecEditError;
        const payload = {ok: false, code: typed.code ?? 'EVENT_UNAVAILABLE', message: 'Event history is temporarily unavailable.', byte_limit: EVENT_RESPONSE_BYTE_LIMIT};
        return {contents: [{uri: RESOURCE_URIS.events, mimeType: 'application/json', text: JSON.stringify(payload)}]};
      }
    },
  );

  // cladding://audit — HITL audit log (.cladding/audit.log).
  server.registerResource(
    'audit',
    RESOURCE_URIS.audit,
    {
      title: 'Cladding audit log',
      description: 'HITL audit log — every persona dispatch and human signoff.',
      mimeType: 'application/x-ndjson',
    },
    async () => {
      const auditPath = join(cwd, '.cladding', 'audit.log.jsonl');
      const text = existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : '';
      return {
        contents: [
          {uri: RESOURCE_URIS.audit, mimeType: 'application/x-ndjson', text},
        ],
      };
    },
  );
}

function registerPrompts(server: McpServer, cwd: string): void {
  const register = (promptName: string, personaId: string, description: string): void => {
    server.registerPrompt(
      promptName,
      {
        title: `Cladding persona — ${personaId}`,
        description,
        argsSchema: {
          featureId: z
            .string()
            .optional()
            .describe('Optional feature id to interpolate into the persona context'),
        },
      },
      (args) => {
        const persona = loadPersona(personaId);
        const featureLine = args.featureId ? `\nActive feature: ${args.featureId}\n` : '';
        return {
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: `${persona.body}${featureLine}`,
              },
            },
          ],
        };
      },
    );
  };
  for (const id of PERSONA_IDS) {
    register(id, id, `Persona prompt body for the ${id} agent.`);
  }
  // 0.6.0 alias prompts — old names serve the renamed persona's body so hosts
  // with cached prompt names keep working; removed in 0.8.
  for (const [oldName, newId] of Object.entries(PERSONA_PROMPT_ALIASES)) {
    register(
      oldName,
      newId,
      `Persona prompt body for the ${newId} agent. (Renamed: '${oldName}' is now '${newId}' in 0.6.0 — this alias is removed in 0.8.)`,
    );
  }
  // Suppress the unused-cwd lint — cwd is reserved for future
  // per-project persona overrides under <cwd>/.cladding/agents/.
  void cwd;
}
