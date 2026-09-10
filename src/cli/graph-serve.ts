// Cladding · CLI · live graph server — F-64a5c159
//
// `clad graph serve` is the LIVE view: the graph is a pure derivation of the
// spec, so instead of re-exporting a snapshot, we serve it and recompute on
// every request. A stdlib node:http server (zero deps) serves the viewer at
// `/`, the freshly-computed presentation graph at `/graph.json`, the public
// schema_version 2 corpus statistics at `/graph-v2.json`, and an SSE stream at
// `/events`. node:fs.watch on spec/ + docs/ broadcasts a debounced refresh so
// open browsers auto-reload as development proceeds — build the view once, it
// stays live. No stale-trap: the server always recomputes from the live spec;
// if it dies, the connection closes (visible), not silently stale.

import {createServer, type ServerResponse} from 'node:http';
import {existsSync, watch, type FSWatcher} from 'node:fs';
import {join} from 'node:path';

import {presentGraph, type KnowledgeGraph} from '../graph/presentation.js';
import {loadGraphIrV2Workspace, type GraphIrV2Workspace} from '../graph/query.js';
import {statisticsV2} from '../graph/wire-v2.js';
import {toJson} from '../graph/render.js';
import {toHtmlShell} from '../graph/viewer-shell.js';
import {nodeHealth} from '../stages/graph-health.js';
import {pulse} from '../ui/pulse.js';

export interface GraphServer {
  readonly port: number;
  /** Push an SSE `refresh` to every connected viewer (also fired by file watching). */
  broadcast(): void;
  close(): Promise<void>;
}

/**
 * Boots the live graph HTTP server bound to localhost. Recomputes the graph from
 * a freshly loaded GraphIR workspace on every request (always current). Resolves
 * once listening. `port: 0` lets the OS pick a free port (used by tests).
 */
export function createGraphServer(opts: {readonly port?: number; readonly cwd?: string} = {}): Promise<GraphServer> {
  const cwd = opts.cwd ?? '.';
  const clients = new Set<ServerResponse>();
  // Every request pays one full GraphIR workspace load (~1s on cladding-self).
  // That is the price of "always live, never stale" until the F9c workspace cache
  // lands; a cached workspace here would reintroduce exactly the stale-trap this
  // server exists to avoid, so the fix belongs in the cache, not in a snapshot.
  const liveWorkspace = (): GraphIrV2Workspace => loadGraphIrV2Workspace(cwd);
  const liveGraph = (): KnowledgeGraph => presentGraph(liveWorkspace(), {cwd});
  const broadcast = (): void => {
    for (const c of clients) {
      try {
        c.write('data: refresh\n\n');
      } catch {
        clients.delete(c);
      }
    }
  };

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    // DNS-rebinding guard: the server binds 127.0.0.1, but a hostile web page can
    // still point a rebound hostname at it — only local Host headers are served.
    const host = (req.headers.host ?? '').split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') {
      res.writeHead(403, {'Content-Type': 'text/plain'});
      res.end('forbidden host');
      return;
    }
    try {
      // Bodies are computed BEFORE writeHead on every non-SSE route: a mid-write /
      // unparseable spec throws in liveGraph(), and committing 200+JSON headers first
      // turned that into an HTTP 200 with a prose YAML error as the "JSON" body.
      if (path === '/graph.json') {
        const body = toJson(liveGraph());
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        res.end(body);
        return;
      }
      if (path === '/graph-v2.json') {
        // The public schema_version 2 surface: deterministic corpus counts, never a
        // whole-graph dump. `/graph.json` keeps the presentation shape the viewer reads.
        const body = JSON.stringify(statisticsV2(liveWorkspace()));
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        res.end(body);
        return;
      }
      if (path === '/health.json') {
        // KILLER: live spec↔code conformance from cladding's drift detectors, per node.
        const body = JSON.stringify(nodeHealth(liveGraph(), cwd));
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        res.end(body);
        return;
      }
      if (path === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (path === '/' || path === '/index.html') {
        // The viewer self-wires SSE (EventSource('events')) and re-fetches graph/health
        // on refresh — health-only changes heal smoothly, structural changes reload.
        const body = toHtmlShell(liveGraph());
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
        res.end(body);
        return;
      }
      res.writeHead(404, {'Content-Type': 'text/plain'});
      res.end('not found');
    } catch (err) {
      // Error-as-data: a temporarily unreadable spec is a 503 JSON payload the viewer
      // can react to, never a 200. headersSent stays guarded for mid-stream failures
      // (SSE) where the status line is already on the wire.
      if (!res.headersSent) {
        res.writeHead(503, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        try {
          res.end(JSON.stringify({error: (err as Error).message}));
        } catch {
          /* socket already gone */
        }
      } else {
        try {
          res.end();
        } catch {
          /* socket already gone */
        }
      }
    }
  });

  // Debounced file watching → SSE refresh (fs.watch is platform-racy; coalesce).
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onChange = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(broadcast, 400);
  };
  const watchers: FSWatcher[] = [];
  for (const dir of ['spec', 'docs']) {
    const abs = join(cwd, dir);
    if (!existsSync(abs)) continue;
    try {
      const w = watch(abs, {recursive: true}, onChange);
      // A runtime watcher error (EMFILE, deleted root, …) must degrade to
      // manual refresh — an unhandled 'error' event would crash the server.
      w.on('error', () => {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      });
      watchers.push(w);
    } catch {
      /* recursive watch unsupported on this platform → skip (manual refresh still works) */
    }
  }
  // SSE keep-alive (proxies/firewalls drop idle connections >60s).
  const ka = setInterval(() => {
    for (const c of clients) {
      try {
        c.write(': keep-alive\n\n');
      } catch {
        clients.delete(c);
      }
    }
  }, 30000);
  if (typeof ka.unref === 'function') ka.unref();

  return new Promise((resolve, reject) => {
    // A listen failure (EADDRINUSE on a busy port) rejects the boot promise so the
    // CLI's catch prints one pulse line — before this the 'error' event was unhandled
    // and the process died with a raw stack while the promise never settled. The
    // listener stays attached for the server's lifetime (rejecting a settled promise
    // is a no-op) so later runtime errors can't crash the process either.
    server.on('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
      resolve({
        port,
        broadcast,
        close: () =>
          new Promise<void>((done) => {
            if (timer) clearTimeout(timer);
            clearInterval(ka);
            for (const w of watchers) {
              try {
                w.close();
              } catch {
                /* already closed */
              }
            }
            for (const c of clients) {
              try {
                c.end();
              } catch {
                /* already closed */
              }
            }
            clients.clear();
            server.close(() => done());
            // Force idle keep-alive sockets shut so close() resolves promptly (Node 18.2+).
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          }),
      });
    });
  });
}

/** Handler for `clad graph serve` — boots the live server and keeps the process alive. */
export async function runGraphServeCommand(opts: {readonly port?: string; readonly cwd?: string} = {}): Promise<void> {
  const port = opts.port !== undefined ? Number(opts.port) : 3000;
  try {
    const srv = await createGraphServer({port, cwd: opts.cwd ?? '.'});
    pulse(
      'pass',
      'graph',
      `live graph at http://localhost:${srv.port} — edit spec/ or docs/ and the view auto-reloads (Ctrl-C to stop)`,
    );
    // The server + watchers keep the event loop alive until Ctrl-C.
  } catch (err) {
    pulse('fail', 'graph', (err as Error).message);
    process.exit(1);
  }
}
