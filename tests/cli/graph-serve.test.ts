import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
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

  test('a watched-file change broadcasts an SSE refresh', async () => {
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
});
