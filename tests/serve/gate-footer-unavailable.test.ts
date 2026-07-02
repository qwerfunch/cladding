// Cladding · gateFooter fallback honesty (F-c6a32fff)
//
// The gate footer rides every mutating MCP tool result — for hosts without
// lifecycle hooks (Gemini/Codex) it is the ONLY structural gate channel. The
// v0.7.0 catch branch fabricated {pass:true, findings:[]} when the drift
// engine itself threw: an engine fault read as a verified GREEN. This suite
// mocks the drift engine to throw and asserts the footer now fails closed
// ({pass:false, unavailable:true}) — "could not run" is not "ran green".

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/stages/drift.js', () => ({
  runDrift: (): never => {
    throw new Error('engine fault: detector exploded');
  },
}));

const {buildServer} = await import('../../src/serve/server.js');

describe('gateFooter — engine fault fails closed, never a fabricated GREEN', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-gatefooter-'));
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: fixture\n', 'utf8');
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('a throwing drift engine yields gate {pass:false, unavailable:true} on a mutating tool result', async () => {
    const server = buildServer({cwd: dir, name: 'cladding-test', version: '0.0.0-test'});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'cladding-test-client', version: '0.0.0-test'});
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const res = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'probe-feature', title: 'Probe'},
      });
      const doc = JSON.parse((res.content as Array<{type: string; text: string}>)[0].text) as {
        gate: {pass: boolean; unavailable?: boolean; findings: unknown[]; next?: string};
      };
      expect(doc.gate.pass).toBe(false);
      expect(doc.gate.unavailable).toBe(true);
      expect(doc.gate.findings).toEqual([]);
      expect(doc.gate.next).toContain('clad check --strict');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
