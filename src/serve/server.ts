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
// `clad sync` / `clad drive` running the same drift detectors,
// the same spec loader, the same audit log — only the transport
// differs.
//
// @see src/cli/serve.ts — stdio process entry point.
// @see spec/features/F-073.yaml — server scaffold AC matrix.

import {readFileSync, existsSync, statSync} from 'node:fs';
import {join} from 'node:path';

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

import {loadPersona} from '../agents/loader.js';
import {subscribeAudit} from '../hitl/audit.js';
import {classifyIntent} from '../intent/classifier.js';
import {loadSpec} from '../spec/load.js';
import {createFeature, createScenario} from '../spec/new.js';
import type {Feature} from '../spec/types.js';
import {runDrift} from '../stages/drift.js';
import {detectHost} from '../agents/host-detect.js';
import {auditWorkCompliance} from '../work/audit.js';
import {completeDrive, executeDrive} from '../work/drive-transaction.js';
import {abandonWork, completeWork, enterWork} from '../work/transaction.js';

/** Persona ids registered as MCP prompts (mirrors src/agents/). */
export const PERSONA_IDS = [
  'orchestrator',
  'librarian',
  'reviewer',
  'observability',
  'specialists',
] as const;

/** Tool names cladding's MCP server exposes (stable wire identifiers). */
export const TOOL_NAMES = [
  'clad_list_features',
  'clad_get_feature',
  'clad_run_check',
  'clad_get_events',
  'clad_create_feature',
  'clad_create_scenario',
  // 0.4.3 — work transaction MCP tools (F-89406c / F-ca18ea).
  'enter_work',
  'complete_work',
  'abandon_work',
  // 0.4.4 — drive transaction MCP tools (F-d23cd4).
  'execute_drive',
  'complete_drive',
  // 0.4.6 — Layer-D auditor MCP tool (F-89406c, plan §"4-Layer defense").
  'audit_work_compliance',
  // 0.4.10 PR-A.2 — host detection MCP tool for the 4-host multi-agent first redesign.
  'detect_host',
  // 0.4.13 PR-D.1 (F-b426b0) — prompt-stage intent classifier MCP tool.
  // Host AI on Codex/Cursor/Antigravity/Gemini self-calls before any
  // Edit/Write to decide whether to enter_work / clad_create_feature.
  // Claude Code additionally gets a UserPromptSubmit hook (PR-D.2).
  'assess_intent',
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
      version: opts.version ?? '0.5.0',
    },
    {
      // Declare subscribe support so clients can subscribe to
      // cladding://audit and receive notifications/resources/updated
      // when new evidence lands. The wire-level handlers themselves
      // are registered below in registerSubscribeHandlers — the
      // McpServer high-level wrapper does not include them by
      // default (verified against SDK 1.29 sources).
      capabilities: {resources: {subscribe: true}},
    },
  );

  registerTools(server, cwd);
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

function registerTools(server: McpServer, cwd: string): void {
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
    },
    async (args) => {
      const spec = loadSpec(cwd);
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
        'Returns one feature record by id (e.g. "F-049" or "F-a3f9c2") or by slug ' +
        '(e.g. "login-flow"). When a slug matches multiple features, all matches are returned.',
      inputSchema: {
        id: z.string().optional().describe('Feature id such as "F-049" or "F-a3f9c2"'),
        slug: z.string().optional().describe("Feature slug such as 'login-flow'"),
      },
    },
    async (args) => {
      if (!args.id && !args.slug) {
        return {
          isError: true,
          content: [{type: 'text', text: 'provide either id or slug'}],
        };
      }
      const spec = loadSpec(cwd);
      const matches = spec.features.filter((f) => {
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
      description: 'Runs `clad check` drift detection; returns the structured result.',
      inputSchema: {
        strict: z.boolean().optional().describe('Treat warnings as errors when true'),
      },
    },
    async (args) => {
      const result = runDrift({strict: args.strict, cwd});
      return {
        content: [{type: 'text', text: JSON.stringify(result, null, 2)}],
        isError: !result.pass,
      };
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
    },
    async (args) => {
      const limit = args.limit ?? 50;
      const eventsPath = join(cwd, '.cladding', 'events.log.jsonl');
      if (!existsSync(eventsPath)) {
        return {
          content: [{type: 'text', text: JSON.stringify({events: [], note: 'no events log yet'})}],
        };
      }
      const lines = readFileSync(eventsPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      const tail = lines.slice(-limit);
      return {
        content: [{type: 'text', text: JSON.stringify({events: tail.map((l) => JSON.parse(l))}, null, 2)}],
      };
    },
  );

  // clad_create_feature — issue a new sharded feature file under
  // spec/features/<slug>.yaml with a content-hash id (v0.3.9, F-084).
  // Host LLM invokes this when the user asks for a new feature in
  // natural language; cladding has no `clad spec new` CLI verb by design.
  server.registerTool(
    'clad_create_feature',
    {
      title: 'Create a new cladding feature',
      description:
        'Creates spec/features/<slug>.yaml with an auto-generated F-<hash> id. ' +
        'Two concurrent invocations on separate branches produce distinct hash ' +
        'ids by construction (input includes user + hostname + timestamp + ' +
        'hrtime), so multi-developer concurrency is safe as long as slugs differ.',
      inputSchema: {
        slug: z
          .string()
          .regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/)
          .describe(
            "Kebab-case slug — filename + spec.slug field (e.g. 'login-flow')",
          ),
        title: z.string().optional().describe('Optional human-readable title; defaults to slug'),
        status: z
          .enum(['planned', 'in_progress', 'done', 'blocked', 'archived'])
          .optional()
          .describe("Optional status; defaults to 'planned'"),
      },
    },
    async (args) => {
      try {
        const result = createFeature({
          slug: args.slug,
          title: args.title,
          status: args.status,
          cwd,
        });
        return {
          content: [{type: 'text', text: JSON.stringify(result, null, 2)}],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{type: 'text', text: (err as Error).message}],
        };
      }
    },
  );

  // clad_create_scenario — issue a new sharded scenario file under
  // spec/scenarios/<slug>-<hash6>.yaml (v0.3.12, F-087). Same
  // multi-developer safety story as clad_create_feature.
  server.registerTool(
    'clad_create_scenario',
    {
      title: 'Create a new cladding scenario',
      description:
        'Creates spec/scenarios/<slug>-<hash6>.yaml with an auto-generated S-<hash> id. ' +
        'Same multi-dev safety property as clad_create_feature: two concurrent invocations on ' +
        'separate branches produce distinct hash ids by construction.',
      inputSchema: {
        slug: z
          .string()
          .regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/)
          .describe("Kebab-case slug (e.g. 'checkout-happy-path')"),
        title: z.string().optional().describe('Optional human-readable title; defaults to slug'),
        features: z
          .array(z.string().regex(/^F-(\d{3,}|[a-f0-9]{6,})$/))
          .optional()
          .describe('Optional list of feature ids the scenario touches'),
      },
    },
    async (args) => {
      try {
        const result = createScenario({
          slug: args.slug,
          title: args.title,
          features: args.features,
          cwd,
        });
        return {
          content: [{type: 'text', text: JSON.stringify(result, null, 2)}],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{type: 'text', text: (err as Error).message}],
        };
      }
    },
  );

  // ── 0.4.3 work transaction tools (F-89406c / F-ca18ea) ──
  // MUST-clause baked into every description so host AI prompt-engineering
  // (Layer B of the 4-layer defense) picks it up alongside the Layer A
  // trigger guidance in AGENTS.md / CLAUDE.md.

  server.registerTool(
    'enter_work',
    {
      title: 'Enter a work transaction on a single feature',
      description:
        'MUST be called BEFORE any Edit / Write / file-mutation tool when the user request ' +
        'touches a single feature. Transitions the feature from planned → in_progress and ' +
        'returns the specialists persona prompt + the scoped module list. The host AI then ' +
        "adopts that persona for the turn — cladding never dispatches an LLM itself. " +
        'Call complete_work when the change is done, or abandon_work to back out.',
      inputSchema: {
        featureId: z
          .string()
          .regex(/^F-(\d{3,}|[a-f0-9]{6,})$/)
          .describe('Target feature id (e.g. F-89406c). Must already exist in spec/features/.'),
        intent: z
          .string()
          .optional()
          .describe('Free-form intent the host AI extracted from the user prompt (for the event log).'),
        personaId: z
          .enum(['specialists', 'reviewer'])
          .optional()
          .describe("Persona to adopt. Defaults to 'specialists'."),
      },
    },
    async (args) => {
      try {
        const result = enterWork({
          featureId: args.featureId,
          intent: args.intent,
          personaId: args.personaId,
          cwd,
        });
        return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  server.registerTool(
    'complete_work',
    {
      title: 'Close a work transaction with the full L1 iron-law gate',
      description:
        'MUST be called AFTER the last code-edit tool call of a work transaction. Runs the ' +
        'full L1 band — drift (27 detectors scoped to feature.modules) + type (stage 1.1) + ' +
        'lint (stage 1.2) + arch (stage 1.5). On pass: transitions the feature in_progress → ' +
        'done, appends any supplied evidence refs, removes the registry entry, and returns a ' +
        '`reviewerGuidance` field carrying the reviewer persona body — the host AI is expected ' +
        'to self-switch personas on the next turn and audit the change before the user merges. ' +
        'On iron-law failure the status stays in_progress and the call can be retried after ' +
        'fixing the offending gate.',
      inputSchema: {
        featureId: z
          .string()
          .regex(/^F-(\d{3,}|[a-f0-9]{6,})$/)
          .describe('Same featureId that was passed to enter_work.'),
        evidence: z
          .array(
            z.object({
              acId: z.string().describe('Acceptance criterion id (e.g. AC-001).'),
              ref: z.string().describe('Evidence ref string — tests/foo.test.ts, script:NAME, fixture:NAME, etc.'),
            }),
          )
          .optional()
          .describe('Optional evidence to append to acceptance_criteria[].evidence_refs.'),
      },
    },
    async (args) => {
      try {
        const result = completeWork({
          featureId: args.featureId,
          evidence: args.evidence,
          cwd,
        });
        return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  server.registerTool(
    'abandon_work',
    {
      title: 'Cancel an open work transaction without changing status',
      description:
        'Use when the user changes direction mid-turn or the scope turns out to be wrong. ' +
        'Removes the registry entry, records a work_abandoned event, and PRESERVES the ' +
        'feature status (in_progress stays in_progress — no rollback in 0.4.x). A later ' +
        'enter_work on the same featureId resumes from the same status.',
      inputSchema: {
        featureId: z
          .string()
          .regex(/^F-(\d{3,}|[a-f0-9]{6,})$/)
          .describe('Same featureId that was passed to enter_work.'),
        reason: z.string().describe('Why the work is being abandoned (recorded in the event log).'),
      },
    },
    async (args) => {
      try {
        const result = abandonWork({featureId: args.featureId, reason: args.reason, cwd});
        return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // ── 0.4.4 drive transaction tools (F-d23cd4) ──
  // Same Layer-B MUST-clause pattern as the work tools; this set targets
  // multi-feature scenarios (bundled work) rather than single features.

  server.registerTool(
    'execute_drive',
    {
      title: 'Open a drive transaction on a scenario (bundled multi-feature work)',
      description:
        'MUST be called BEFORE any Edit / Write / file-mutation tool when the user request ' +
        'spans multiple features or a whole user journey ("결제 모듈 추가해줘", "refactor the spec ' +
        'layer", "rewrite onboarding"). Atomic single-feature work goes through enter_work ' +
        'instead. Loads the scenario, sorts its features by depends_on, auto-enters the first ' +
        'ready feature via enter_work, and returns the ordered plan. The host AI then ' +
        'iterates enter_work / complete_work for each remaining featureId in plan, and calls ' +
        'complete_drive at the end to seal the scenario.',
      inputSchema: {
        scenarioId: z
          .string()
          .regex(/^S-(\d{3,}|[a-f0-9]{6,})$/)
          .optional()
          .describe('Direct scenario id (e.g. S-d21acd). Mutually exclusive with intent.'),
        intent: z
          .string()
          .optional()
          .describe(
            'Free-form intent — cladding deterministically matches against scenario.title + ' +
              'scenario.flow text in 0.4.4 (substring boost + token overlap). LLM-based ' +
              'matching is a 0.5.x option.',
          ),
      },
    },
    async (args) => {
      try {
        const result = executeDrive({scenarioId: args.scenarioId, intent: args.intent, cwd});
        return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  server.registerTool(
    'complete_drive',
    {
      title: 'Seal a drive transaction after the last feature completes',
      description:
        'Call AFTER the last complete_work of a drive. Inspects every feature in the ' +
        'scenario on disk, partitions into passed (status: done | archived) / failed ' +
        '(status: blocked) / pending (anything else), and emits a drive_completed event ' +
        'with the partition. Does NOT mutate spec.yaml — each feature\'s status was ' +
        "already written by its underlying complete_work transition. Returns the partition " +
        'so the host AI can summarise the drive outcome to the user.',
      inputSchema: {
        scenarioId: z
          .string()
          .regex(/^S-(\d{3,}|[a-f0-9]{6,})$/)
          .describe('Same scenarioId that was passed to execute_drive.'),
      },
    },
    async (args) => {
      try {
        const result = completeDrive({scenarioId: args.scenarioId, cwd});
        return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // ── 0.4.6 Layer-D auditor ──
  // Read-only inspection of .cladding/events.log.jsonl. Surfaces still-
  // open transactions, completed/abandoned/timed-out records, and the
  // temporal "orphan windows" between transactions where the host AI
  // may have edited code outside any work scope.

  server.registerTool(
    'audit_work_compliance',
    {
      title: 'Layer-D compliance audit — open transactions + orphan windows',
      description:
        'Call at the end of a turn (or when a session resumes) to inspect recent work ' +
        'transactions. Reports still-open transactions (caller should resume or abandon), ' +
        'completed / abandoned / timed-out records, and temporal "orphan windows" where ' +
        'the host AI may have edited code outside any transaction. 0.4.6 is event-log ' +
        'analysis only; file-system diff cross-referencing lands in 0.4.7 once the ' +
        'per-host PreToolUse hook adapter is wired.',
      inputSchema: {
        sinceMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Only consider events newer than this many ms. Default: 86_400_000 (24h).'),
        orphanThresholdMs: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Orphan windows shorter than this are ignored. Default: 5_000 (5s).'),
      },
    },
    async (args) => {
      try {
        const result = auditWorkCompliance({
          cwd,
          sinceMs: args.sinceMs,
          orphanThresholdMs: args.orphanThresholdMs,
        });
        return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // ── 0.4.10 PR-A.2 host detection ──
  // Reports the active host + tier (1/2/3) so host AIs can branch on
  // capability (e.g. only Tier 1 receives sub-agent dispatch hints).
  // PR-A.3 will consume this from enterWork to shape its response.

  server.registerTool(
    'detect_host',
    {
      title: 'Identify the active AI host + multi-agent tier',
      description:
        'Returns {host, tier, signals, overridden}. host ∈ {claude-code, codex, cursor, ' +
        'antigravity, gemini, generic}. tier ∈ {1, 2, 3}: Tier 1 = native sub-agent dispatch ' +
        '(Claude Code/Codex/Cursor/Antigravity); Tier 2 = sub-agent preview (Gemini, sunsetting ' +
        'June 18 2026 → Antigravity); Tier 3 = multi-persona fallback. Detection reads ' +
        'process.env signals (CLAUDECODE / CODEX_* / CURSOR_* / TERM_PROGRAM / GEMINI_* / ' +
        'ANTIGRAVITY_*). Override via CLADDING_HOST env when a wrapper sets misleading signals.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = detectHost();
        return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}]};
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // ── 0.4.13 PR-D.1 prompt-stage intent classifier (F-b426b0) ──
  // Deterministic — same promptText always produces the same output.
  // No LLM call. Host AIs on Codex / Cursor / Antigravity / Gemini
  // self-call this *before* any Edit/Write to decide whether to invoke
  // enter_work / clad_create_feature. Claude Code additionally gets a
  // UserPromptSubmit hook (PR-D.2) that injects the same hint into
  // additionalContext automatically; the MCP tool stays available for
  // explicit self-call even on Claude Code.

  server.registerTool(
    'assess_intent',
    {
      title: 'Classify a user prompt as dev intent (auto-trigger advisor)',
      description:
        'Call when you receive a user prompt and are unsure whether to trigger a ' +
        'work/drive transaction. Returns {intent, confidence, matchedTokens, ' +
        'suggestedAction, featureCandidates?}. intent ∈ {dev-new, dev-modify, ' +
        'dev-review, non-dev, ambiguous}. suggestedAction ∈ {clad_create_feature, ' +
        'enter_work, silent}. Use suggestedAction to decide the next call before any ' +
        'Edit/Write tool. Deterministic — identical promptText always returns identical ' +
        'output. Host AI MAY call this once per user turn; cladding never invokes an LLM.',
      inputSchema: {
        promptText: z
          .string()
          .describe('Raw user prompt text exactly as received from the user'),
      },
    },
    async (args) => {
      try {
        let features:
          | ReadonlyArray<{id: string; slug?: string; title?: string}>
          | undefined;
        try {
          const spec = loadSpec(cwd);
          features = spec.features.map((f) => ({
            id: f.id,
            // Feature type doesn't declare slug, but every sharded
            // feature carries one on the YAML body — the type widening
            // here keeps the candidate ranking working without a spec
            // schema migration. Falls back to '' when truly absent.
            slug: (f as Feature & {slug?: string}).slug,
            title: f.title,
          }));
        } catch {
          // spec not loadable (e.g. cladding not initialised in this
          // cwd, or schema-invalid). Classification still works —
          // featureCandidates simply absent.
        }
        const result = classifyIntent(args.promptText, {features});
        return {
          content: [{type: 'text', text: JSON.stringify(result, null, 2)}],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{type: 'text', text: (err as Error).message}],
        };
      }
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
 * - new model: `<slug>-<hash>.yaml`
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
      const spec = loadSpec(cwd);
      return {
        contents: [
          {
            uri: RESOURCE_URIS.spec,
            mimeType: 'application/json',
            text: JSON.stringify(spec, null, 2),
          },
        ],
      };
    },
  );

  // cladding://events — events.log raw lines (JSONL).
  server.registerResource(
    'events',
    RESOURCE_URIS.events,
    {
      title: 'Cladding events log',
      description: 'Raw JSONL stream of feature_activated, evidence_appended, gate_run, …',
      mimeType: 'application/x-ndjson',
    },
    async () => {
      const eventsPath = join(cwd, '.cladding', 'events.log.jsonl');
      const text = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8') : '';
      return {
        contents: [
          {uri: RESOURCE_URIS.events, mimeType: 'application/x-ndjson', text},
        ],
      };
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
  for (const id of PERSONA_IDS) {
    server.registerPrompt(
      id,
      {
        title: `Cladding persona — ${id}`,
        description: `Persona prompt body for the ${id} agent.`,
        argsSchema: {
          featureId: z
            .string()
            .optional()
            .describe('Optional feature id to interpolate into the persona context'),
        },
      },
      (args) => {
        const persona = loadPersona(id);
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
  }
  // Suppress the unused-cwd lint — cwd is reserved for future
  // per-project persona overrides under <cwd>/.cladding/agents/.
  void cwd;
}
