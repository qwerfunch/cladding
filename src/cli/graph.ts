// Cladding · CLI · graph export + stats — F-569f4b37
//
// `clad graph export` renders the knowledge graph to a best-in-class viewer
// (mermaid / dot / json to stdout; obsidian to a vault dir). `clad graph stats`
// prints counts + hubs. The heavy lifting is pure (src/graph/*); this is glue.

import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {buildGraph, resolveNodeIds, subgraph} from '../graph/model.js';
import {toDot, toJson, toMermaid, toObsidianVault} from '../graph/render.js';
import {toHtmlShell} from '../graph/viewer-shell.js';
import {nodeHealth} from '../stages/graph-health.js';
import {graphStats, renderStats} from '../graph/stats.js';
import {loadSpec} from '../spec/load.js';
import {pulse} from '../ui/pulse.js';

export type GraphFormat = 'mermaid' | 'dot' | 'json' | 'obsidian' | 'html';

export interface GraphExportOptions {
  readonly format?: string;
  readonly focus?: string;
  readonly depth?: string;
  readonly out?: string;
}

const FORMATS: ReadonlySet<string> = new Set(['mermaid', 'dot', 'json', 'obsidian', 'html']);

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
    const spec = loadSpec();
    let graph = buildGraph(spec, '.');

    if (opts.focus) {
      // A path focus seeds every kind-twin (module:/test:/doc: nodes of one file) —
      // first-twin-only silently dropped the other twins' edges from the neighborhood.
      const focusIds = resolveNodeIds(spec, graph, opts.focus);
      if (focusIds.length === 0) {
        pulse('fail', 'graph', `no node matches '${opts.focus}' — try a feature id (F-…), slug, or module path`);
        process.exit(1);
        return;
      }
      const depth = opts.depth !== undefined ? Number(opts.depth) : Infinity;
      if (Number.isNaN(depth) || depth < 0) {
        pulse('fail', 'graph', `--depth must be a non-negative number, got '${opts.depth}'`);
        process.exit(1);
        return;
      }
      graph = subgraph(graph, focusIds, depth);
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

    const rendered = format === 'dot' ? toDot(graph) : format === 'json' ? toJson(graph) : toMermaid(graph);
    if (opts.out) {
      mkdirSync(dirname(opts.out), {recursive: true});
      writeFileSync(opts.out, rendered, 'utf8');
      pulse('pass', 'graph', `wrote ${format} graph to ${opts.out}`);
      process.exit(0);
    } else {
      // Flush before exit: on a pipe, stdout.write is async — exiting on the next
      // line truncates output larger than the OS pipe buffer (~64 KiB on macOS).
      // Exit from the write callback so the full payload drains first.
      process.stdout.write(rendered, () => process.exit(0));
    }
  } catch (err) {
    pulse('fail', 'graph', (err as Error).message);
    process.exit(1);
  }
}

/** Handler for `clad graph stats`. */
export function runGraphStatsCommand(): void {
  try {
    const graph = buildGraph(loadSpec(), '.');
    // Flush before exit (see runGraphExportCommand) so piped output never truncates.
    process.stdout.write(renderStats(graphStats(graph)), () => process.exit(0));
  } catch (err) {
    pulse('fail', 'graph', (err as Error).message);
    process.exit(1);
  }
}
