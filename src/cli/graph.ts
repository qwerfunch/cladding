// Cladding · CLI · graph export + stats — F-569f4b37
//
// `clad graph export` renders the knowledge graph to a best-in-class viewer
// (mermaid / dot / json to stdout; obsidian to a vault dir). `clad graph stats`
// prints counts + hubs. The heavy lifting is pure (src/graph/*); this is glue.

import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {buildGraph, resolveNodeId, subgraph} from '../graph/model.js';
import {toDot, toJson, toMermaid, toObsidianVault} from '../graph/render.js';
import {graphStats, renderStats} from '../graph/stats.js';
import {loadSpec} from '../spec/load.js';
import {pulse} from '../ui/pulse.js';

export type GraphFormat = 'mermaid' | 'dot' | 'json' | 'obsidian';

export interface GraphExportOptions {
  readonly format?: string;
  readonly focus?: string;
  readonly depth?: string;
  readonly out?: string;
}

/** Handler for `clad graph export`. */
export function runGraphExportCommand(opts: GraphExportOptions = {}): void {
  try {
    const format = (opts.format ?? 'mermaid') as GraphFormat;
    const spec = loadSpec();
    let graph = buildGraph(spec, '.');

    if (opts.focus) {
      const focusId = resolveNodeId(spec, graph, opts.focus);
      if (!focusId) {
        pulse('fail', 'graph', `no node matches '${opts.focus}' — try a feature id (F-…), slug, or module path`);
        process.exit(1);
        return;
      }
      const depth = opts.depth !== undefined ? Number(opts.depth) : Infinity;
      graph = subgraph(graph, focusId, depth);
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

    const rendered = format === 'dot' ? toDot(graph) : format === 'json' ? toJson(graph) : toMermaid(graph);
    if (opts.out) {
      mkdirSync(dirname(opts.out), {recursive: true});
      writeFileSync(opts.out, rendered, 'utf8');
      pulse('pass', 'graph', `wrote ${format} graph to ${opts.out}`);
    } else {
      process.stdout.write(rendered);
    }
    process.exit(0);
  } catch (err) {
    pulse('fail', 'graph', (err as Error).message);
    process.exit(1);
  }
}

/** Handler for `clad graph stats`. */
export function runGraphStatsCommand(): void {
  try {
    const graph = buildGraph(loadSpec(), '.');
    process.stdout.write(renderStats(graphStats(graph)));
    process.exit(0);
  } catch (err) {
    pulse('fail', 'graph', (err as Error).message);
    process.exit(1);
  }
}
