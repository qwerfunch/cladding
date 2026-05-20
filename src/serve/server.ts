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
import {loadSpec} from '../spec/load.js';
import {createFeature} from '../spec/new.js';
import {runDrift} from '../stages/drift.js';

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
      version: opts.version ?? '0.3.11',
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
