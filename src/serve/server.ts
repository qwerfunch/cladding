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

import {spawnSync} from 'node:child_process';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

import {loadPersona} from '../agents/loader.js';
import {collectChangelog, defaultSinceRef} from '../changelog/collect.js';
import {renderAuditTable, renderCatalog, renderChangelogMarkdown} from '../changelog/render.js';
import {subscribeAudit} from '../hitl/audit.js';
import {loadSpec} from '../spec/load.js';
import type {Spec} from '../spec/types.js';
import {createFeature, createScenario, linkCapability} from '../spec/new.js';
import {recordOracle} from '../oracle/record.js';
import {doneFeatureCount, oracleRequired, resolveOraclePolicy} from '../oracle/policy.js';
import {maintainDeliverable} from '../spec/deliverable-detect.js';
import {computeInventory, writeInventoryToSpecYaml, writeFeatureIndex} from '../spec/inventory.js';
import {buildContextSlice} from '../optimizer/context-slice.js';
import {buildImpactSlice} from '../optimizer/reverse-slice.js';
import {buildWorkingSet} from '../optimizer/working-set.js';
import {buildGraph, resolveNodeIds, subgraph} from '../graph/model.js';
import {graphStats} from '../graph/stats.js';
import {runDrift} from '../stages/drift.js';

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
  'clad_list_features',
  'clad_get_feature',
  'clad_run_check',
  'clad_get_events',
  'clad_create_feature',
  'clad_create_scenario',
  'clad_link_capability',
  'clad_author_oracle',
  'clad_run_gate',
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
      version: opts.version ?? '0.7.0',
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

/** Frozen wire field (F-570a3f): bump when a tool's payload shape changes. */
const PAYLOAD_SCHEMA_VERSION = 1;

/**
 * F-570a3f — the gate state rides every mutating tool result as a JSON field
 * (the withHint pattern; never appended text). Tool results are the one
 * channel the model cannot not see, on every host — and Gemini/Codex have no
 * lifecycle hooks, so this is their only structural enforcement channel.
 */
function gateFooter(cwd: string): {pass: boolean; findings: ReadonlyArray<{detector?: string; severity: string; message: string}>; next?: string} {
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
    return {pass: true, findings: []};
  }
}


/** Locate the engine's bin shim relative to this module — works in the dist
 * bundle (dist/clad.js → ../bin/clad) and the dev tree (src/serve/ → ../../bin/clad). */
function engineShim(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'bin', 'clad');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
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
      const tier = args.tier ?? 'pre-commit';
      const strict = args.strict !== false;
      const res = spawnSync(shim, ['check', `--tier=${tier}`, ...(strict ? ['--strict'] : []), '--json'], {
        cwd,
        encoding: 'utf8',
        timeout: 300_000,
      });
      try {
        const doc = JSON.parse(res.stdout || '') as {worst?: number};
        return {
          isError: (doc.worst ?? 1) !== 0,
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
                error: 'gate produced no parseable JSON',
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
        const spec = loadSpec(cwd);
        const slice = buildContextSlice(spec, args.query);
        const miss = 'not_found' in slice;
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
        const ws = buildWorkingSet(loadSpec(cwd), args.query, {cwd, maxTokens: args.max_tokens});
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
  // "What breaks if I change this?" Walks the reverse-index dependents and
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
        const spec = loadSpec(cwd);
        const slice = buildImpactSlice(spec, args.query, {depth: args.max_depth});
        const miss = 'not_found' in slice;
        return {
          isError: miss,
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...slice}, null, 2)}],
        };
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
      }
    },
  );

  // clad_get_graph (F-64a5c159) — the live spec↔code↔doc knowledge graph as a
  // focused neighborhood, or a stats SUMMARY when no focus is given. The whole
  // graph is ~285KB (~70k tokens) on cladding-self and grows with the project —
  // an unbudgeted MCP payload that contradicts the working-set discipline — so
  // the no-query form answers with graphStats + hubs and points at the CLI
  // export for full dumps. Always recomputed from the current spec (never stale).
  server.registerTool(
    'clad_get_graph',
    {
      title: 'Get the live knowledge graph (focused neighborhood, or a stats summary)',
      description:
        'With query: the focus node’s N-hop neighborhood — nodes (feature/module/skill/test/scenario/capability/doc, ' +
        'tier-classified A/B/C/D, features labeled by slug) + typed edges (depends_on/touches/covers/binds/' +
        'implements/references/links); a path query unions all its kind-twins (module/test/doc nodes of one file). ' +
        'WITHOUT query: a compact summary (node/edge counts by kind + top hubs) — the full graph is tens of ' +
        'thousands of tokens, use `clad graph export --format json` for a complete dump. Recomputed live — never stale.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Focus node: feature id (F-…), slug, or module path. Omit for the stats summary.'),
        max_depth: z
          .number()
          .int()
          .positive()
          .max(6)
          .optional()
          .describe('Neighborhood radius around the focus node (default: full reachable subgraph from the focus)'),
      },
    },
    async (args) => {
      try {
        const spec = loadSpec(cwd);
        const graph = buildGraph(spec, cwd);
        if (!args.query) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    schema_version: PAYLOAD_SCHEMA_VERSION,
                    summary: true,
                    stats: graphStats(graph),
                    hint:
                      'pass query (feature id, slug, or module path) for a neighborhood subgraph; ' +
                      '`clad graph export --format json` dumps the full graph',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        const focusIds = resolveNodeIds(spec, graph, args.query);
        if (focusIds.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    schema_version: PAYLOAD_SCHEMA_VERSION,
                    not_found: args.query,
                    accepted_forms: ['feature id (F-…)', 'slug', 'module path'],
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        const focused = subgraph(graph, focusIds, args.max_depth ?? Infinity);
        return {
          content: [
            {type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...focused}, null, 2)},
          ],
        };
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
        'Returns the deterministic shipped-changes manifest for <since>..HEAD (default since: the latest tag): ' +
        'feature shards classified (added-as-done / flipped-to-done / modified-while-done / archived) grouped by ' +
        'capability with an uncategorized bucket, the spec inventory count diff, and conventional feat:/fix: ' +
        "commits that name no feature id (work that shipped outside the spec). For HUMAN-FACING release notes, " +
        "render from the manifest in the project's language(s), sourcing every claim from a feature title or " +
        "acceptance-criterion sentence — never invent a change the manifest does not carry. format:'markdown' is " +
        "the deterministic English fallback (no internal ids), 'audit' the id-keeping verification table " +
        "(refs marked resolved ✓/✗), 'catalog' the full capability → feature → acceptance listing (no git range).",
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
      // A single corrupt/partial JSONL line (a mid-write tail read) must not
      // crash the whole tool call — surface it as data instead.
      const events = tail.map((l) => {
        try {
          return JSON.parse(l) as unknown;
        } catch {
          return {unparseable: l.slice(0, 200)};
        }
      });
      return {
        content: [{type: 'text', text: JSON.stringify({events}, null, 2)}],
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
        'Author the feature WITH its acceptance_criteria (and modules) in this one ' +
        'call — a feature created with no acceptance_criteria is a hollow stub that ' +
        'governs nothing. Two concurrent invocations on separate branches produce ' +
        'distinct hash ids by construction, so multi-developer concurrency is safe.',
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
        modules: z
          .array(z.string())
          .optional()
          .describe('Module paths the feature binds to (e.g. ["src/auth/login.ts"]).'),
        acceptance_criteria: z
          .array(
            z.object({
              ears: z.enum(['ubiquitous', 'event', 'state', 'optional', 'unwanted', 'complex']).optional(),
              text: z.string().optional().describe('The "The system shall …" statement.'),
              action: z.string().optional(),
              response: z.string().optional(),
              condition: z.string().optional().describe('Trigger/precondition for event/state EARS.'),
              test_refs: z.array(z.string()).optional().describe('Paths to verifying tests.'),
              evidence_refs: z.array(z.string()).optional(),
              notes: z.string().optional(),
            }),
          )
          .optional()
          .describe(
            'Acceptance criteria authored now (ids auto-assigned AC-001…). Strongly ' +
              'preferred over an empty feature — this is what makes the feature governable.',
          ),
      },
    },
    async (args) => {
      try {
        const result = createFeature({
          slug: args.slug,
          title: args.title,
          status: args.status,
          modules: args.modules,
          acceptance_criteria: args.acceptance_criteria,
          cwd,
        });
        syncInventory(cwd);
        // Non-mutating firing-path nudge: travels as a `hint` FIELD (keeps the
        // payload valid JSON), never a silent write to capabilities.yaml.
        const withHint = {
          schema_version: PAYLOAD_SCHEMA_VERSION,
          ...result,
          gate: gateFooter(cwd),
          hint:
            'If this feature is user-facing, link it to a capability with clad_link_capability ' +
            `(capability: <kebab-id>, feature: ${result.id}) so the Tier-B design SSoT grows with ` +
            'development instead of being left an empty seed.',
        };
        return {
          content: [{type: 'text', text: JSON.stringify(withHint, null, 2)}],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{type: 'text', text: (err as Error).message}],
        };
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
      inputSchema: {
        featureId: z.string().describe('The F-<hash> feature id.'),
        acId: z.string().describe('The AC-<id> the oracle verifies.'),
        body: z.string().describe('The authored vitest oracle source (imports the module under test).'),
        readManifest: z
          .array(z.string())
          .describe('EXACTLY what the blind sub-agent was shown (the clad oracle brief: spec/AC + signatures). MUST NOT include an implementation file the feature owns.'),
        blind: z.boolean().optional().describe('True only if the sub-agent saw the spec-only brief and nothing else.'),
        authorName: z.string().optional().describe('Oracle author identity (sub-agent / model id) — must differ from the implementer for the gate to pass.'),
      },
    },
    async (args) => {
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
        syncInventory(cwd);
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
        return {content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...result, ...voluntary, gate: gateFooter(cwd)}, null, 2)}], isError: !result.ok};
      } catch (err) {
        return {isError: true, content: [{type: 'text', text: (err as Error).message}]};
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
        flow: z
          .string()
          .optional()
          .describe('Prose user-journey flow (what the user does, step by step).'),
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
          flow: args.flow,
          features: args.features,
          cwd,
        });
        syncInventory(cwd);
        return {
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...result, gate: gateFooter(cwd)}, null, 2)}],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{type: 'text', text: (err as Error).message}],
        };
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
      inputSchema: {
        capability: z
          .string()
          .regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/)
          .describe("Capability id (kebab-slug, e.g. 'auth'). Created if it does not exist yet."),
        feature: z
          .string()
          .regex(/^F-(\d{3,}|[a-f0-9]{6,})$/)
          .describe('Feature id to add to the capability'),
        title: z.string().optional().describe('Title, used only when the capability is newly created'),
        summary: z.string().optional().describe('Summary, used only when newly created'),
        surface: z
          .enum(['feature', 'platform', 'tool', 'infrastructure'])
          .optional()
          .describe('Surface, used only when newly created'),
      },
    },
    async (args) => {
      try {
        const result = linkCapability({
          capability: args.capability,
          feature: args.feature,
          title: args.title,
          summary: args.summary,
          surface: args.surface,
          cwd,
        });
        syncInventory(cwd);
        return {
          content: [{type: 'text', text: JSON.stringify({schema_version: PAYLOAD_SCHEMA_VERSION, ...result, gate: gateFooter(cwd)}, null, 2)}],
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
 * Recomputes and writes `spec.yaml`'s `inventory:` block after a create tool
 * adds a shard, so the project's stats never desync from the real shard count
 * (an INVENTORY_DRIFT the new detector would otherwise flag). Best-effort: a
 * create must not fail because an inventory write hiccupped, and a project
 * without a `spec.yaml` (nothing to update) is silently skipped.
 */
function syncInventory(cwd: string): void {
  try {
    if (existsSync(join(cwd, 'spec.yaml'))) {
      writeInventoryToSpecYaml(cwd, computeInventory(cwd));
      writeFeatureIndex(cwd); // F-37b4a8
      // v0.5.x — when a CLI entry now exists but no deliverable is declared, auto-populate it
      // (calibrated to pass now) so DELIVERABLE_SMOKE engages BEFORE the agent reacts to the
      // INTEGRITY warn and declares it disabled. One-time (skips once present).
      maintainDeliverable(cwd);
    }
  } catch {
    // intentional no-op — inventory sync is a convenience, not a gate.
  }
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
