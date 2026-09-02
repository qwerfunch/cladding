// Cladding · CLI · graph export + stats — F-569f4b37 / F-208eaa79
//
// `clad graph export` renders the knowledge graph to a best-in-class viewer
// (mermaid / dot / json to stdout; obsidian to a vault dir). `clad graph stats`
// prints counts + hubs. The heavy lifting is pure (src/graph/*); this is glue.
//
// Since the GraphIR v2 cutover this command reads ONE workspace and answers from
// two surfaces of it: the presentation graph the renderers and the viewer consume
// (`presentGraph`), and the public schema_version 2 wire (`src/graph/wire-v2.ts`).
// `--format json` without `--focus` is the explicit complete export the wire owns;
// `--focus` is a relation-aware, bounded projection the wire validates, never an
// undirected neighbourhood walk.
//
// @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-e4a233ae
// @see spec/features/graph-export-viz-569f4b37.yaml AC-d95b03ac

import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {parseAnchorAddress} from '../spec/compiler/graph-address.js';
import {presentGraph, nodeId, subgraph, type KnowledgeGraph} from '../graph/presentation.js';
import {loadGraphIrV2Workspace, type GraphIrV2Workspace} from '../graph/query.js';
import {exportGraphV2, focusedProjectionV2, type WireEnvelopeV2} from '../graph/wire-v2.js';
import {toDot, toMermaid, toObsidianVault} from '../graph/render.js';
import {toHtmlShell} from '../graph/viewer-shell.js';
import {nodeHealth} from '../stages/graph-health.js';
import {graphStats, renderStats} from '../graph/stats.js';
import {pulse} from '../ui/pulse.js';

export type GraphFormat = 'mermaid' | 'dot' | 'json' | 'obsidian' | 'html';

export interface GraphExportOptions {
  readonly format?: string;
  readonly focus?: string;
  readonly depth?: string;
  readonly maxNodes?: string;
  readonly maxEdges?: string;
  readonly out?: string;
}

const FORMATS: ReadonlySet<string> = new Set(['mermaid', 'dot', 'json', 'obsidian', 'html']);

/** The envelope's own COMPACT serialization plus one newline terminator. The v2
 *  contract is exact final bytes: `meta.payload_utf8_bytes` is the fixed point of
 *  `JSON.stringify(envelope)`, so re-indenting here would make the size the payload
 *  reports about itself untrue of the bytes the caller actually receives. */
function renderEnvelope(envelope: WireEnvelopeV2): string {
  return `${JSON.stringify(envelope)}\n`;
}

/** Reads an optional numeric CLI bound. An unparseable spelling stays NaN so the
 *  wire — the single owner of the bound contract — rejects it with its own reason. */
function bound(raw: string | undefined): number | undefined {
  return raw === undefined ? undefined : Number(raw);
}

/**
 * Maps one projected GraphIR address to every presentation node it denotes.
 *
 * Semantic features, scenarios, and capabilities carry the same identity in both
 * models. A physical artifact materializes as up to three presentation kind-twins
 * (`module:` — which also carries skills — `test:`, `doc:`), and an anchor stands
 * for its containing artifact. Criteria, architecture rules, and the project node
 * have no drawn counterpart and contribute nothing.
 */
function presentationIds(address: string, present: ReadonlySet<string>): string[] {
  const anchor = parseAnchorAddress(address);
  const path = anchor ? anchor.path : address.startsWith('artifact:') ? address.slice('artifact:'.length) : undefined;
  const candidates =
    path === undefined
      ? [address] // feature:/scenario:/capability: share the presentation spelling.
      : [nodeId.module(path), nodeId.test(path), nodeId.doc(path)];
  return candidates.filter((candidate) => present.has(candidate));
}

/** Restricts the presentation graph to exactly the nodes one projection materialized. */
function projectedPresentation(presentation: KnowledgeGraph, envelope: WireEnvelopeV2): KnowledgeGraph {
  const present = new Set(presentation.nodes.map((node) => node.id));
  const ids = new Set<string>();
  for (const node of envelope.nodes ?? []) {
    for (const id of presentationIds(node.address, present)) ids.add(id);
  }
  // Depth 0: the projection already decided the neighbourhood, so this only induces
  // the edges among those nodes rather than widening the set a second time.
  return subgraph(presentation, [...ids], 0);
}

/** Prints a non-answer envelope (rejected bounds / unresolved query) and exits 1. */
function failEnvelope(envelope: WireEnvelopeV2, focus: string): never {
  if (envelope.kind === 'rejected') {
    for (const reason of envelope.reasons) pulse('fail', 'graph', reason);
    process.exit(1);
  }
  const resolution = envelope.resolution;
  if (resolution?.state === 'ambiguous') {
    // "Matches nothing" would be a false statement here, and the candidate list is
    // exactly what lets the caller retry with a canonical spelling.
    pulse('fail', 'graph', `'${focus}' matches more than one node — ${resolution.reason}`);
    for (const candidate of resolution.candidates ?? []) pulse('note', 'graph', `candidate: ${candidate}`);
  } else {
    pulse('fail', 'graph', `no graph node matches '${focus}' — ${resolution?.reason ?? 'unresolved'}`);
  }
  for (const form of resolution?.accepted_forms ?? []) pulse('note', 'graph', `accepted: ${form}`);
  process.exit(1);
}

/** Writes to `--out` or streams to stdout, flushing before exit (see below). */
function emit(rendered: string, out: string | undefined, label: string): void {
  if (out) {
    mkdirSync(dirname(out), {recursive: true});
    writeFileSync(out, rendered, 'utf8');
    pulse('pass', 'graph', `wrote ${label} graph to ${out}`);
    process.exit(0);
    return;
  }
  // Flush before exit: on a pipe, stdout.write is async — exiting on the next
  // line truncates output larger than the OS pipe buffer (~64 KiB on macOS).
  // Exit from the write callback so the full payload drains first. The complete
  // v2 export is megabytes, so this guard matters more than it did at 285 KiB.
  process.stdout.write(rendered, () => process.exit(0));
}

/** Handler for `clad graph export`. */
export function runGraphExportCommand(opts: GraphExportOptions = {}): void {
  try {
    // A typo'd --format used to fall through SILENTLY to mermaid — fail loudly instead.
    const requested = opts.format ?? 'mermaid';
    if (!FORMATS.has(requested)) {
      pulse('fail', 'graph', `unknown --format '${requested}' — use mermaid | dot | json | obsidian | html`);
      process.exit(1);
      return;
    }
    const format = requested as GraphFormat;
    const workspace: GraphIrV2Workspace = loadGraphIrV2Workspace('.');

    if (!opts.focus && format === 'json') {
      // The complete export is an explicit request, never a default focused answer.
      emit(renderEnvelope(exportGraphV2(workspace)), opts.out, 'json');
      return;
    }

    let graph = presentGraph(workspace, {cwd: '.'});
    if (opts.focus) {
      const envelope = focusedProjectionV2(
        workspace,
        {
          query: opts.focus,
          ...(bound(opts.depth) === undefined ? {} : {max_depth: bound(opts.depth)}),
          ...(bound(opts.maxNodes) === undefined ? {} : {max_nodes: bound(opts.maxNodes)}),
          ...(bound(opts.maxEdges) === undefined ? {} : {max_edges: bound(opts.maxEdges)}),
          view: 'full',
        },
        {byteCeiling: null},
      );
      if (envelope.kind !== 'projection') failEnvelope(envelope, opts.focus);
      if (format === 'json') {
        emit(renderEnvelope(envelope), opts.out, 'json');
        return;
      }
      graph = projectedPresentation(graph, envelope);
    }

    if (format === 'obsidian') {
      const outDir = opts.out ?? '.cladding/graph';
      const vault = toObsidianVault(graph);
      for (const [rel, content] of vault) {
        const abs = join(outDir, rel);
        mkdirSync(dirname(abs), {recursive: true});
        writeFileSync(abs, content, 'utf8');
      }
      pulse('pass', 'graph', `wrote ${vault.size} note(s) to ${outDir} — open it as an Obsidian vault`);
      process.exit(0);
      return;
    }

    if (format === 'html') {
      if (!opts.out) {
        pulse('fail', 'graph', '--format html requires --out <path> (a single self-contained .html file)');
        process.exit(1);
        return;
      }
      const html = toHtmlShell(graph, nodeHealth(graph, '.'));
      mkdirSync(dirname(opts.out), {recursive: true});
      writeFileSync(opts.out, html, 'utf8');
      pulse('pass', 'graph', `wrote a self-contained viewer to ${opts.out} — open it in a browser (offline)`);
      process.exit(0);
      return;
    }

    emit(format === 'dot' ? toDot(graph) : toMermaid(graph), opts.out, format);
  } catch (err) {
    pulse('fail', 'graph', (err as Error).message);
    process.exit(1);
  }
}

/** Handler for `clad graph stats`. */
export function runGraphStatsCommand(): void {
  try {
    const graph = presentGraph(loadGraphIrV2Workspace('.'), {cwd: '.'});
    // Flush before exit (see emit) so piped output never truncates.
    process.stdout.write(renderStats(graphStats(graph)), () => process.exit(0));
  } catch (err) {
    pulse('fail', 'graph', (err as Error).message);
    process.exit(1);
  }
}
