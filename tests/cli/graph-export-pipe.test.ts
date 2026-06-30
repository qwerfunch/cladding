// Cladding · `clad graph export` pipe-flush regression guard.
//
// Bug (found by the pre-PR empirical sweep): runGraphExportCommand wrote the
// rendered graph to stdout and then called `process.exit(0)` on the NEXT line.
// On a pipe, `stdout.write` is async — `process.exit` killed the process before
// the OS pipe buffer (~64 KiB) drained, truncating any export larger than that
// (cladding's own graph is ~285 KiB). File / `--out` (synchronous writes) were
// unaffected, so only the documented `clad graph export … | jq` path broke.
//
// Reproduce it the way it actually fails: spawn the CLI so its stdout is a PIPE
// (execFileSync pipes the child's stdout) and confirm the whole JSON arrives
// intact. Before the fix this returns exactly 65536 bytes and fails to parse.

import {execFileSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('clad graph export — flushes stdout before exit (no 64 KiB pipe truncation)', () => {
  test('--format json over a pipe arrives complete and parseable', () => {
    const out = execFileSync('npx', ['tsx', 'src/cli/clad.ts', 'graph', 'export', '--format', 'json'], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    // Must exceed the pipe buffer or the guard is vacuous — cladding's own spec
    // renders well past 64 KiB. (65536 = the exact byte count the bug truncated to.)
    expect(out.length).toBeGreaterThan(65536);
    // The truncated output was cut mid-structure and could not be parsed.
    const graph = JSON.parse(out) as {nodes: {kind: string}[]; edges: unknown[]};
    expect(graph.nodes.some((n) => n.kind === 'feature')).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(0);
  }, 60_000);
});
