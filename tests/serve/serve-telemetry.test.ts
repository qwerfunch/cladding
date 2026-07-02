// Cladding · F-6ba22c5c AC-373257b2 — MCP read serves record working_set_served.
//
// Drives the three read tools (clad_get_working_set / clad_get_context /
// clad_get_impact) through an in-process Client over InMemoryTransport (the
// server.test.ts pattern), then reads the event ledger the server wrote and
// asserts one working_set_served per serve — hit AND miss — with the tool name
// and the resolved flag. A resolved working-set serve additionally carries
// {truncated, sliceTokens}.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {readEvents} from '../../src/events/log.js';
import {buildServer} from '../../src/serve/server.js';

const IMPACT_SPEC = `schema: "0.1"
project:
  name: probe
  language: typescript
features:
  - id: F-001
    slug: core-thing
    title: core
    status: done
    modules: [src/core.ts]
    acceptance_criteria:
      - id: AC-001
        ears: ubiquitous
        text: core AC
        test_refs: ["tests/core.test.ts#core works"]
  - id: F-002
    slug: dependent-thing
    title: dependent
    status: done
    depends_on: [F-001]
    modules: [src/dependent.ts]
    acceptance_criteria:
      - id: AC-002
        ears: ubiquitous
        text: dependent AC
        test_refs: ["tests/dependent.test.ts#dependent works"]
`;

async function makeClient(cwd: string): Promise<{client: Client; cleanup: () => Promise<void>}> {
  const server = buildServer({cwd, name: 'cladding-test', version: '0.0.0-test'});
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'cladding-test-client', version: '0.0.0-test'});
  await Promise.all([server.connect(st), client.connect(ct)]);
  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

function serves(cwd: string) {
  return readEvents(cwd).filter((e) => e.type === 'working_set_served');
}

describe('MCP serve telemetry (F-6ba22c5c AC-373257b2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-vt-serve-'));
    writeFileSync(join(dir, 'spec.yaml'), IMPACT_SPEC);
    mkdirSync(join(dir, 'src'), {recursive: true});
    writeFileSync(join(dir, 'src', 'core.ts'), 'export const CORE_MARKER = 42;\n', 'utf8');
    mkdirSync(join(dir, '.cladding'), {recursive: true});
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('clad_get_working_set hit → resolved:true with truncated + sliceTokens; miss → resolved:false', async () => {
    const {client, cleanup} = await makeClient(dir);
    try {
      await client.callTool({name: 'clad_get_working_set', arguments: {query: 'F-001', max_tokens: 5000}});
      await client.callTool({name: 'clad_get_working_set', arguments: {query: 'nope'}});
    } finally {
      await cleanup();
    }
    const evs = serves(dir);
    expect(evs).toHaveLength(2);
    const hit = evs.find((e) => e.payload.query === 'F-001')!;
    const miss = evs.find((e) => e.payload.query === 'nope')!;
    expect(hit.payload).toMatchObject({tool: 'clad_get_working_set', resolved: true, truncated: expect.any(Boolean)});
    expect(hit.payload.sliceTokens as number).toBeGreaterThan(0);
    expect(miss.payload).toMatchObject({tool: 'clad_get_working_set', resolved: false});
  });

  test('clad_get_context serve is recorded on hit (resolved:true) and miss (resolved:false)', async () => {
    const {client, cleanup} = await makeClient(dir);
    try {
      await client.callTool({name: 'clad_get_context', arguments: {query: 'F-001'}});
      await client.callTool({name: 'clad_get_context', arguments: {query: 'nope'}});
    } finally {
      await cleanup();
    }
    const evs = serves(dir).filter((e) => e.payload.tool === 'clad_get_context');
    expect(evs.map((e) => e.payload.resolved).sort()).toEqual([false, true]);
  });

  test('clad_get_impact serve is recorded on hit (resolved:true) and miss (resolved:false)', async () => {
    const {client, cleanup} = await makeClient(dir);
    try {
      await client.callTool({name: 'clad_get_impact', arguments: {query: 'F-001'}});
      await client.callTool({name: 'clad_get_impact', arguments: {query: 'nope'}});
    } finally {
      await cleanup();
    }
    const evs = serves(dir).filter((e) => e.payload.tool === 'clad_get_impact');
    expect(evs.map((e) => e.payload.resolved).sort()).toEqual([false, true]);
  });

  test('all three read tools land under one servedByTool histogram', async () => {
    const {client, cleanup} = await makeClient(dir);
    try {
      await client.callTool({name: 'clad_get_working_set', arguments: {query: 'F-001'}});
      await client.callTool({name: 'clad_get_context', arguments: {query: 'F-001'}});
      await client.callTool({name: 'clad_get_impact', arguments: {query: 'F-001'}});
    } finally {
      await cleanup();
    }
    const byTool = new Set(serves(dir).map((e) => e.payload.tool));
    expect(byTool).toEqual(new Set(['clad_get_working_set', 'clad_get_context', 'clad_get_impact']));
  });
});
