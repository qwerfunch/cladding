// Cladding · CLI · live graph server — F-64a5c159
//
// `clad graph serve` is the LIVE view: the graph is a pure derivation of the
// spec, so instead of re-exporting a snapshot, we serve it and recompute on
// every request. A stdlib node:http server (zero deps) serves the viewer at
// `/`, the freshly-computed graph at `/graph.json`, and an SSE stream at
// `/events`. node:fs.watch on spec/ + docs/ broadcasts a debounced refresh so
// open browsers auto-reload as development proceeds — build the view once, it
// stays live. No stale-trap: the server always recomputes from the live spec;
// if it dies, the connection closes (visible), not silently stale.

import {createServer, type ServerResponse} from 'node:http';
import {existsSync, watch, type FSWatcher} from 'node:fs';
import {join} from 'node:path';

import {buildGraph} from '../graph/model.js';
import {toJson} from '../graph/render.js';
import {toHtmlShell} from '../graph/viewer-shell.js';
import {loadSpec} from '../spec/load.js';
import {pulse} from '../ui/pulse.js';

// Injected into the served page only (not the frozen export): reload on SSE refresh.
const SSE_RELOAD =
  '<script>(function(){try{var e=new EventSource("/events");e.onmessage=function(){location.reload();};}catch(_){}})();</script>';

export interface GraphServer {
  readonly port: number;
  /** Push an SSE `refresh` to every connected viewer (also fired by file watching). */
  broadcast(): void;
  close(): Promise<void>;
}

/**
 * Boots the live graph HTTP server bound to localhost. Recomputes buildGraph on
 * every request (always current). Resolves once listening. `port: 0` lets the
 * OS pick a free port (used by tests).
 */
export function createGraphServer(opts: {readonly port?: number; readonly cwd?: string} = {}): Promise<GraphServer> {
  const cwd = opts.cwd ?? '.';
  const clients = new Set<ServerResponse>();
  const liveGraph = (): ReturnType<typeof buildGraph> => buildGraph(loadSpec(cwd), cwd);
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
    try {
      if (path === '/graph.json') {
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        res.end(toJson(liveGraph()));
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
        const html = toHtmlShell(liveGraph()).replace('</body>', `${SSE_RELOAD}\n</body>`);
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
        res.end(html);
        return;
      }
      res.writeHead(404, {'Content-Type': 'text/plain'});
      res.end('not found');
    } catch (err) {
      // Headers may already be sent (e.g. an SSE stream) — only set status if not.
      if (!res.headersSent) res.writeHead(500, {'Content-Type': 'text/plain'});
      try {
        res.end((err as Error).message);
      } catch {
        /* socket already gone */
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
      watchers.push(watch(abs, {recursive: true}, onChange));
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

  return new Promise((resolve) => {
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
