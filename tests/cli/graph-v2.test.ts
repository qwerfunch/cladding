// Cladding · Spec 0.2 F8 · `clad graph` over the GraphIR v2 public wire.
//
// Five assertions here can only be made against the SHIPPED command, so they spawn
// it (`npx tsx src/cli/clad.ts …`) against cladding's own corpus: the complete
// export must be an explicit request, it must survive a PIPE whole (stdout is a
// pipe here and the v2 export is megabytes, so a `process.exit` that raced the
// drain would truncate the payload exactly as it did before v0.7.1), the bytes it
// prints must be the exact compact serialization the envelope measured itself as,
// `--focus` must be a bounded depth-1 projection rather than an undirected walk,
// and an out-of-range bound must exit non-zero naming its reason.
//
// Everything the command only forwards — renderer determinism, the obsidian vault,
// the stats shape, the remaining rejected bounds and the unmatched query — is a
// property of the pure functions behind it (`src/graph/*`), so those run in-process
// against one loaded workspace. Spawning them too cost ~28 s of gate time and
// proved nothing the direct call does not.

import {execFileSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {beforeAll, describe, expect, test} from 'vitest';

import {presentGraph, type KnowledgeGraph} from '../../src/graph/presentation.js';
import {loadGraphIrV2Workspace, type GraphIrV2Workspace} from '../../src/graph/query.js';
import {toDot, toMermaid, toObsidianVault} from '../../src/graph/render.js';
import {graphStats, renderStats} from '../../src/graph/stats.js';
import {exportGraphV2, focusedProjectionV2} from '../../src/graph/wire-v2.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAX_BUFFER = 64 * 1024 * 1024;
const TIMEOUT = 120_000;

/** Runs the CLI and returns stdout; a non-zero exit throws (see `failing`). */
function graph(...args: readonly string[]): string {
  return execFileSync('npx', ['tsx', 'src/cli/clad.ts', 'graph', ...args], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
}

/** Runs a CLI call expected to fail, returning its exit status and printed output. */
function failing(...args: readonly string[]): {readonly status: number; readonly output: string} {
  try {
    const stdout = graph(...args);
    return {status: 0, output: stdout};
  } catch (err) {
    const failure = err as {status?: number; stdout?: string; stderr?: string};
    return {
      status: failure.status ?? -1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
}

interface WireEnvelope {
  readonly schema_version: number;
  readonly kind: string;
  readonly workspace_schema: string;
  readonly completeness: string;
  readonly nodes?: readonly {readonly address: string; readonly kind?: string; readonly type: string}[];
  readonly edges?: readonly {readonly from: string; readonly to: string; readonly relation: string}[];
  readonly meta: {
    readonly seeds: readonly string[];
    readonly bounds: {readonly max_depth: number | null; readonly max_nodes: number | null};
    readonly counts: {readonly nodes: number; readonly edges: number};
    readonly payload_utf8_bytes: number;
  };
}

describe('clad graph — GraphIR v2 wire (F-208eaa79 / F-569f4b37)', () => {
  // The command reads exactly this, from the repository root, as `clad graph` does.
  let workspace: GraphIrV2Workspace;
  let presentation: KnowledgeGraph;

  beforeAll(() => {
    workspace = loadGraphIrV2Workspace('.');
    presentation = presentGraph(workspace, {cwd: '.'});
  });

  test('[covers:F-208eaa79/AC-e4a233ae][covers:F-569f4b37/AC-0b21a485] --format json is the explicit complete schema_version 2 export, whole over a pipe', () => {
    const first = graph('export', '--format', 'json');

    // A truncated export was cut mid-structure and could not be parsed. It must also
    // exceed the OS pipe buffer or the flush guard would be vacuous — 65536 is the
    // exact byte count the pre-v0.7.1 bug truncated to.
    expect(first.length).toBeGreaterThan(65536);
    const envelope = JSON.parse(first) as WireEnvelope;

    expect(envelope.schema_version).toBe(2);
    expect(envelope.kind).toBe('export');
    expect(envelope.workspace_schema).toBe('0.2');
    // A complete export is intentionally unbounded; a focused answer never is.
    expect(envelope.meta.bounds).toEqual({max_depth: null, max_nodes: null, max_edges: null});
    expect(envelope.meta.seeds).toEqual([]);
    expect(envelope.nodes?.some((node) => node.kind === 'feature')).toBe(true);
    expect(envelope.nodes?.some((node) => node.type === 'artifact')).toBe(true);
    expect(envelope.edges?.length ?? 0).toBeGreaterThan(0);
    expect(envelope.meta.counts.nodes).toBe(envelope.nodes?.length);
    expect(envelope.meta.counts.edges).toBe(envelope.edges?.length);

    // The v2 wire contract is exact final bytes, so what a caller receives must be
    // the compact serialization the envelope measured ITSELF as, plus one newline
    // terminator. Pretty-printing inflated this by ~623 KiB and made
    // `meta.payload_utf8_bytes` untrue of the payload the caller actually holds.
    expect(first.endsWith('\n')).toBe(true);
    expect(Buffer.byteLength(first, 'utf8')).toBe(envelope.meta.payload_utf8_bytes + 1);

    expect(graph('export', '--format', 'json')).toBe(first);
  }, TIMEOUT);

  test('[covers:F-569f4b37/AC-d95b03ac][covers:F-208eaa79/AC-b61f6aa5] --focus is a bounded depth-1 projection with no neighbour-of-neighbour expansion', () => {
    const envelope = JSON.parse(graph('export', '--focus', 'F-001', '--format', 'json')) as WireEnvelope;

    expect(envelope.schema_version).toBe(2);
    expect(envelope.kind).toBe('projection');
    expect(envelope.meta.seeds).toEqual(['feature:F-001']);
    expect(envelope.meta.bounds.max_depth).toBe(1);
    expect(envelope.meta.counts.nodes).toBeGreaterThan(1);

    // Depth 1 means every retained edge touches the seed. A neighbour-to-neighbour
    // edge would mean the traversal ran a hop further than the caller asked for.
    const seed = envelope.meta.seeds[0];
    for (const edge of envelope.edges ?? []) {
      expect([edge.from, edge.to], `${edge.relation} edge must touch the seed`).toContain(seed);
    }
    // A whole-corpus answer would also satisfy "contains the seed" — it must not.
    // `exportGraphV2` is the exact function the complete export spawned above runs.
    expect(envelope.meta.counts.nodes).toBeLessThan(exportGraphV2(workspace).meta.counts.nodes);
  }, TIMEOUT);

  test('[covers:F-208eaa79/AC-4ce9a97d] an out-of-range bound exits the CLI 1 naming its reason, and every other bad bound or unmatched query is a named non-answer', () => {
    const depth = failing('export', '--focus', 'F-001', '--depth', '4', '--format', 'json');
    expect(depth.status).toBe(1);
    expect(depth.output).toContain('max_depth must be an integer between 1 and 3');

    // The CLI never invents a reason — it prints what the wire rejected with, so the
    // remaining bounds are checked at their source rather than through another spawn.
    const nodes = focusedProjectionV2(workspace, {query: 'F-001', max_nodes: 0});
    expect(nodes.kind).toBe('rejected');
    expect(nodes.reasons).toContain('max_nodes must be an integer between 1 and 200');

    const edges = focusedProjectionV2(workspace, {query: 'F-001', max_edges: 4000});
    expect(edges.kind).toBe('rejected');
    expect(edges.reasons).toContain('max_edges must be an integer between 1 and 400');

    // An unmatched spelling is an explicit non-answer that repeats what resolves,
    // never an empty success.
    const miss = focusedProjectionV2(workspace, {query: 'no-such-node-xyz'});
    expect(miss.kind).toBe('unresolved');
    expect(miss.nodes).toBeUndefined();
    expect(miss.resolution?.reason).toBe('normalized physical address is absent from this compilation');
    expect(miss.resolution?.accepted_forms).toContain('feature id (F-…)');
    expect(miss.resolution?.discovery).toContain('normal code search');
  }, TIMEOUT);

  test('[covers:F-569f4b37/AC-0afdbdc6] mermaid, dot, and json render deterministically', () => {
    // Two independent reads of the same repository, so this measures the whole
    // load → present → render path rather than one renderer called twice.
    const second = presentGraph(loadGraphIrV2Workspace('.'), {cwd: '.'});

    const mermaid = toMermaid(presentation);
    const dot = toDot(presentation);
    const json = JSON.stringify(focusedProjectionV2(workspace, {query: 'F-001', view: 'full'}, {byteCeiling: null}));

    expect(mermaid.startsWith('graph LR')).toBe(true);
    expect(mermaid.length).toBeGreaterThan(1000);
    expect(dot).toContain('digraph');
    expect(dot.length).toBeGreaterThan(1000);

    expect(toMermaid(second)).toBe(mermaid);
    expect(toDot(second)).toBe(dot);
    expect(JSON.stringify(focusedProjectionV2(
      loadGraphIrV2Workspace('.'), {query: 'F-001', view: 'full'}, {byteCeiling: null},
    ))).toBe(json);
  }, TIMEOUT);

  test('[covers:F-569f4b37/AC-a5a942b7] the obsidian export is a wikilinked markdown vault of one note per node', () => {
    // `--out` writing is `mkdirSync` + `writeFileSync` over exactly this map, so the
    // vault's shape — not the filesystem call — is what the criterion promises.
    const vault = toObsidianVault(presentation);

    expect(vault.size).toBeGreaterThan(10);
    expect(vault.size).toBe(presentation.nodes.length);
    expect([...vault.keys()].every((path) => path.endsWith('.md'))).toBe(true);
    expect([...vault.values()].filter((note) => note.includes('[[')).length).toBeGreaterThan(10);
    expect([...vault.values()].some((note) => note.includes('Backlinks'))).toBe(true);
  }, TIMEOUT);

  test('[covers:F-569f4b37/AC-f8676994] stats reports counts by kind and the top hubs by degree', () => {
    const stats = renderStats(graphStats(presentation));

    expect(stats).toMatch(/^nodes: \d+ {2}\([a-z]+=\d+( {2}[a-z_]+=\d+)*\)$/m);
    expect(stats).toMatch(/^edges: \d+ {2}\([a-z_]+=\d+( {2}[a-z_]+=\d+)*\)$/m);
    expect(stats).toContain('hubs (top by degree):');
    expect(stats).toMatch(/^ {2}[ 1]\d\. \[[a-z]+] .+ — degree \d+$/m);
    expect(stats).toContain('feature=');
  }, TIMEOUT);
});
