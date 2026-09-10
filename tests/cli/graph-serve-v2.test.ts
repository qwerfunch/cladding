// Cladding · Spec 0.2 F8 · the live graph server over the GraphIR v2 workspace.
//
// `clad graph serve` now recomputes from a freshly loaded GraphIR workspace on every
// request. Two contracts have to survive that: `/graph.json` keeps the presentation
// `{nodes, edges}` shape the WebGL viewer parses (a wire envelope there would break
// every open browser), and the new `/graph-v2.json` answers with the public
// schema_version 2 corpus statistics rather than a whole-graph dump. The SSE refresh
// still has to fire on a real watched file change, since "always live" is the reason
// the server recomputes instead of serving a snapshot.

import {mkdirSync, mkdtempSync, rmSync, watch, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {createGraphServer} from '../../src/cli/graph-serve.js';
import {presentGraph} from '../../src/graph/presentation.js';
import {loadGraphIrV2Workspace} from '../../src/graph/query.js';

function get(port: number, path: string): Promise<{status: number; body: string}> {
  return new Promise((resolve, reject) => {
    const req = http.get({host: '127.0.0.1', port, path}, (res) => {
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk) => {
        body += chunk as string;
      });
      res.on('end', () => resolve({status: res.statusCode ?? 0, body}));
    });
    req.on('error', reject);
  });
}

// A minimal spec the cladding schema accepts, so the live graph is non-empty.
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

describe('F-64a5c159 live graph server over GraphIR v2', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-serve-v2-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-64a5c159/AC-6618e320] /graph.json keeps the viewer presentation shape and /graph-v2.json answers with schema_version 2 statistics', async () => {
    const srv = await createGraphServer({port: 0, cwd: dir});
    try {
      const presentation = await get(srv.port, '/graph.json');
      expect(presentation.status).toBe(200);
      // Byte-for-byte the same graph the exporters and the viewer read — the served
      // body is that shape, not a wire envelope wrapped around it.
      expect(JSON.parse(presentation.body)).toEqual(
        JSON.parse(JSON.stringify(presentGraph(loadGraphIrV2Workspace(dir), {cwd: dir}))),
      );
      const served = JSON.parse(presentation.body) as {nodes: {id: string}[]; edges: unknown[]};
      expect(Object.keys(served).sort()).toEqual(['edges', 'nodes']);
      expect(served.nodes.some((node) => node.id === 'feature:F-abc123')).toBe(true);

      const wire = await get(srv.port, '/graph-v2.json');
      expect(wire.status).toBe(200);
      const envelope = JSON.parse(wire.body) as {
        schema_version: number;
        kind: string;
        statistics?: {nodes: {total: number}; edges: {total: number}};
        nodes?: unknown;
        meta: {counts: {nodes: number}};
      };
      expect(envelope.schema_version).toBe(2);
      expect(envelope.kind).toBe('statistics');
      expect(envelope.statistics?.nodes.total).toBeGreaterThan(0);
      // Statistics are counts, never a record dump riding a summary response.
      expect(envelope.nodes).toBeUndefined();
      expect(envelope.meta.counts.nodes).toBe(0);
      expect(wire.body).not.toContain('"from"');
    } finally {
      await srv.close();
    }
  }, 30_000);

  test('[covers:F-64a5c159/AC-94d847fb] a real watched file change reaches SSE through fs.watch and the debounce', async (ctx) => {
    // Capability probe: recursive fs.watch throws on platforms without it — the
    // server degrades to manual refresh there, so the assertion would be false.
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
    const req = http.get({host: '127.0.0.1', port: srv.port, path: '/events'}, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        chunks.push(chunk as string);
      });
    });
    try {
      await new Promise((r) => setTimeout(r, 100)); // let the connection register
      writeFileSync(join(dir, 'spec', 'features', 'live-abc123.yaml'), 'id: F-abc999\n', 'utf8');
      // fs.watch delivery + the server's 400ms debounce — poll generously.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !chunks.join('').includes('data: refresh')) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(chunks.join('')).toContain('data: refresh');
    } finally {
      req.destroy();
      await srv.close();
    }
  }, 30_000);
});
