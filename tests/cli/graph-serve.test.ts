import {mkdirSync, mkdtempSync, rmSync, watch, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {createGraphServer} from '../../src/cli/graph-serve.js';

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface HeaderResult {
  status: number;
  headers: http.IncomingHttpHeaders;
}

function get(port: number, path: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.get({host: '127.0.0.1', port, path}, res => {
      res.setEncoding('utf8');
      let body = '';
      res.on('data', c => {
        body += c;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body,
        });
      });
    });
    req.on('error', reject);
  });
}

// For endpoints that stay open (SSE), resolve as soon as we have the
// response object + headers, then destroy the response stream so we
// don't hang on the open stream.
function getHeaders(port: number, path: string): Promise<HeaderResult> {
  return new Promise((resolve, reject) => {
    const req = http.get({host: '127.0.0.1', port, path}, res => {
      const result: HeaderResult = {
        status: res.statusCode ?? 0,
        headers: res.headers,
      };
      res.destroy();
      resolve(result);
    });
    req.on('error', reject);
  });
}

// A minimal spec that the cladding schema accepts (feature id must match
// ^F-(\d{3,}|[a-f0-9]{6,})$ and AC id ^AC-(\d{3,}|[a-f0-9]{6,})$), so the
// live graph computes a non-empty {nodes, edges}.
const SPEC = `schema: "0.1"
project: {name: t, language: typescript}
features:
  - id: F-abc123
    slug: alpha
    title: alpha
    status: done
    modules: [src/a.ts]
    acceptance_criteria:
      - id: AC-001
        ears: ubiquitous
        text: t
`;

const FEATURE_NODE_ID = 'feature:F-abc123';

describe('F-64a5c159 live graph HTTP server', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-serve-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('serves the live viewer, a fresh graph json, and an SSE events stream', async () => {
    const srv = await createGraphServer({port: 0, cwd: dir});
    try {
      const gj = await get(srv.port, '/graph.json');
      expect(gj.status).toBe(200);
      const g = JSON.parse(gj.body) as {nodes: {id: string}[]; edges: unknown[]};
      expect(g.nodes.length).toBeGreaterThan(0);
      expect(Array.isArray(g.edges)).toBe(true);
      expect(g.nodes.some(n => n.id === FEATURE_NODE_ID)).toBe(true);

      const home = await get(srv.port, '/');
      expect(home.status).toBe(200);
      expect(home.body).toContain('<!DOCTYPE html>');

      const ev = await getHeaders(srv.port, '/events');
      expect(ev.status).toBe(200);
      expect(String(ev.headers['content-type']).includes('text/event-stream')).toBe(true);
    } finally {
      await srv.close();
    }
  });

  test('broadcast() pushes an SSE refresh to connected clients', async () => {
    const srv = await createGraphServer({port: 0, cwd: dir});
    const chunks: string[] = [];
    const req = http.get(
      {host: '127.0.0.1', port: srv.port, path: '/events'},
      res => {
        res.setEncoding('utf8');
        res.on('data', c => {
          chunks.push(c as string);
        });
      },
    );
    try {
      await new Promise(r => setTimeout(r, 100)); // let the connection register
      srv.broadcast();
      await new Promise(r => setTimeout(r, 100)); // let the event arrive
      expect(chunks.join('')).toContain('data: refresh');
    } finally {
      req.destroy();
      await srv.close();
    }
  });

  test('a REAL file change under a watched dir reaches SSE through fs.watch + debounce', async ctx => {
    // Capability probe: recursive fs.watch throws on platforms without it
    // (Linux + Node < 20) — the server degrades to manual refresh there.
    try {
      const probe = watch(dir, {recursive: true}, () => undefined);
      probe.close();
    } catch {
      ctx.skip();
      return;
    }
    // The watcher covers spec/ and docs/ — the dir must exist BEFORE boot.
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    const srv = await createGraphServer({port: 0, cwd: dir});
    const chunks: string[] = [];
    const req = http.get(
      {host: '127.0.0.1', port: srv.port, path: '/events'},
      res => {
        res.setEncoding('utf8');
        res.on('data', c => {
          chunks.push(c as string);
        });
      },
    );
    try {
      await new Promise(r => setTimeout(r, 100)); // let the connection register
      writeFileSync(join(dir, 'spec', 'features', 'live-abc123.yaml'), 'id: F-abc999\n', 'utf8');
      // fs.watch delivery + the server's 400ms debounce — poll generously.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !chunks.join('').includes('data: refresh')) {
        await new Promise(r => setTimeout(r, 100));
      }
      expect(chunks.join('')).toContain('data: refresh');
    } finally {
      req.destroy();
      await srv.close();
    }
  });

  test('an unparseable spec answers 503 with a JSON error body, never 200 (error-as-data)', async () => {
    // Mid-write / truncated YAML: liveGraph() throws AFTER the old code had
    // already committed writeHead(200, application/json) — clients got a 200
    // whose body was a prose YAML error. Now the body is computed first.
    writeFileSync(join(dir, 'spec.yaml'), 'features:\n  - id: F-abc123\n   badly: indented\n', 'utf8');
    const srv = await createGraphServer({port: 0, cwd: dir});
    try {
      for (const path of ['/graph.json', '/health.json', '/']) {
        const r = await get(srv.port, path);
        expect(r.status, `${path} must not pretend success`).toBe(503);
        const doc = JSON.parse(r.body) as {error: string};
        expect(doc.error.length).toBeGreaterThan(0);
      }
    } finally {
      await srv.close();
    }
  });

  test('a busy port rejects the boot promise cleanly instead of crashing the process', async () => {
    const blocker = http.createServer(() => undefined);
    await new Promise<void>(r => blocker.listen(0, '127.0.0.1', () => r()));
    const addr = blocker.address();
    const busyPort = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      await expect(createGraphServer({port: busyPort, cwd: dir})).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await new Promise<void>(r => blocker.close(() => r()));
    }
  });

  test('a foreign Host header is refused (DNS-rebinding guard)', async () => {
    const srv = await createGraphServer({port: 0, cwd: dir});
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.get(
          {host: '127.0.0.1', port: srv.port, path: '/graph.json', headers: {Host: 'evil.example.com'}},
          res => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
      });
      expect(status).toBe(403);
      const local = await get(srv.port, '/graph.json');
      expect(local.status).toBe(200);
    } finally {
      await srv.close();
    }
  });
});
