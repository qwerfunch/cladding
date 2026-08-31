// Cladding · MCP assurance-gate tests.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach, describe, expect, test} from 'vitest';

import {buildServer, cladRunGateCliArgs, cladRunGatePayload} from '../../src/serve/server.js';

const roots: string[] = [];

async function gateClient(cwd: string): Promise<{readonly client: Client; readonly close: () => Promise<void>}> {
  const server = buildServer({cwd, name: 'assurance-gate-test', version: '0.0.0-test'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'assurance-gate-client', version: '0.0.0-test'});
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {client, close: async () => { await client.close(); await server.close(); }};
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('F6 MCP gate transport', () => {
  test('uses the same canonical profile and tier conflict rule as clad check', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'clad-assurance-gate-'));
    roots.push(cwd);
    writeFileSync(join(cwd, 'spec.yaml'), 'schema: "0.1"\nproject: {name: fixture, language: typescript}\nfeatures: []\n');
    const {client, close} = await gateClient(cwd);
    try {
      const result = await client.callTool({name: 'clad_run_gate', arguments: {tier: 'pre-commit', profile: 'push'}}) as {isError?: boolean; content?: Array<{text?: string}>};
      expect(result.isError).toBe(true);
      expect(result.content?.[0]?.text).toMatch(/profile conflicts with the legacy tier alias/i);
    } finally {
      await close();
    }
  });

  test('projects positive profile and assurance-level MCP input onto the exact CLI check vector', () => {
    expect(cladRunGateCliArgs({profile: 'push', assuranceLevel: 'L3', strict: false}))
      .toEqual(['check', '--profile=push', '--assurance-level=L3', '--json']);
    expect(cladRunGateCliArgs({tier: 'pre-push', profile: 'push', assuranceLevel: 'L2', strict: true}))
      .toEqual(['check', '--tier=pre-push', '--profile=push', '--assurance-level=L2', '--strict', '--json']);
  });

  test('preserves the positive CLI assurance semantics in the MCP result envelope', () => {
    const cli = {
      tier: 'pre-push',
      profile: 'push',
      requested_assurance_level: 'L2',
      configured_assurance_level: 'L2',
      achieved_assurance_level: 'L2',
      profile_complete: true,
      scope_sha256: 'a'.repeat(64),
      input_sha256: 'b'.repeat(64),
      obligations: [{obligation: 'stage_1.1', subject: 'project', state: 'pass'}],
      independence: 'not-applicable',
      stages: [{stage: 'stage_1.1', status: 'pass'}],
      worst: 0,
      anyFailed: false,
    };
    expect(cladRunGatePayload(cli)).toEqual({...cli, schema_version: 1});
  });
});
