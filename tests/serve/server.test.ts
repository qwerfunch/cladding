// Cladding · unit tests for src/serve/server.ts
//
// Exercises the v0.2.24 MCP server through an in-process Client paired
// over InMemoryTransport. The tests check that:
//   - all four tools are listed and callable
//   - the three resources are listed and readable
//   - all five persona prompts are listed
//   - clad_get_feature gracefully reports an unknown id
//   - clad_run_check returns the drift report shape
//
// Sampling-based dispatch (v0.2.25) is out of scope here. This file is
// concerned only with the read surface of `clad serve`.

import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {buildServer, PERSONA_IDS, RESOURCE_URIS, TOOL_NAMES} from '../../src/serve/server.js';

const MINIMAL_SPEC = `schema: "0.1"
project:
  name: probe
  language: typescript
features:
  - id: F-001
    slug: alpha-feature
    title: alpha
    status: planned
    modules: []
    acceptance_criteria:
      - id: AC-001
        ears: ubiquitous
        text: probe AC for serve tests
  - id: F-002
    slug: beta-auth-flow
    title: beta
    status: done
    modules: []
    acceptance_criteria:
      - id: AC-002
        ears: ubiquitous
        text: probe AC two
`;

interface Pair {
  client: Client;
  cleanup: () => Promise<void>;
}

async function makePair(cwd: string): Promise<Pair> {
  const server = buildServer({cwd, name: 'cladding-test', version: '0.0.0-test'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'cladding-test-client', version: '0.0.0-test'});
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('serve/server — MCP read surface', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-serve-'));
    writeFileSync(join(dir, 'spec.yaml'), MINIMAL_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('listTools surfaces every declared tool name', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([...TOOL_NAMES].sort());
    } finally {
      await cleanup();
    }
  });

  test('listResources surfaces every declared resource URI', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {resources} = await client.listResources();
      const uris = resources.map((r) => r.uri).sort();
      expect(uris).toEqual([RESOURCE_URIS.audit, RESOURCE_URIS.events, RESOURCE_URIS.spec].sort());
    } finally {
      await cleanup();
    }
  });

  test('listPrompts surfaces every persona id', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {prompts} = await client.listPrompts();
      const names = prompts.map((p) => p.name).sort();
      expect(names).toEqual([...PERSONA_IDS].sort());
    } finally {
      await cleanup();
    }
  });

  test('clad_list_features returns every feature when no filter is set', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({name: 'clad_list_features', arguments: {}});
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.total).toBe(2);
      expect(parsed.features.map((f: {id: string}) => f.id)).toEqual(['F-001', 'F-002']);
    } finally {
      await cleanup();
    }
  });

  test('clad_list_features statusFilter narrows the result', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_list_features',
        arguments: {statusFilter: 'planned'},
      });
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.total).toBe(1);
      expect(parsed.features[0].id).toBe('F-001');
    } finally {
      await cleanup();
    }
  });

  test('clad_list_features slugSubstring filter (F-085, v0.3.10)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_list_features',
        arguments: {slugSubstring: 'auth'},
      });
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      // Only F-002 has slug 'beta-auth-flow' containing 'auth'
      expect(parsed.total).toBe(1);
      expect(parsed.features[0].id).toBe('F-002');
      expect(parsed.features[0].slug).toBe('beta-auth-flow');
    } finally {
      await cleanup();
    }
  });

  test('clad_list_features sort=recent returns array (F-085, v0.3.10)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_list_features',
        arguments: {sort: 'recent'},
      });
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      // Without per-feature yaml files on disk in this test, mtime
      // falls back to 0 for all, so the order is just stable. Assert
      // the response shape is correct (total + features array).
      expect(parsed.total).toBe(2);
      expect(parsed.features).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });

  test('clad_get_feature accepts slug lookup (F-085, v0.3.10)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_get_feature',
        arguments: {slug: 'beta-auth-flow'},
      });
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.id).toBe('F-002');
      expect(parsed.slug).toBe('beta-auth-flow');
    } finally {
      await cleanup();
    }
  });

  test('clad_get_feature without id or slug returns an error (F-085, v0.3.10)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_get_feature',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      expect(text).toMatch(/provide either id or slug/);
    } finally {
      await cleanup();
    }
  });

  test('clad_get_feature returns a single feature when found', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_get_feature',
        arguments: {id: 'F-001'},
      });
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.id).toBe('F-001');
      expect(parsed.title).toBe('alpha');
      expect(result.isError).not.toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('clad_get_feature reports an unknown id as a tool error', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_get_feature',
        arguments: {id: 'F-999'},
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      expect(text).toContain('F-999');
    } finally {
      await cleanup();
    }
  });

  test('clad_run_check returns a drift report shape', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({name: 'clad_run_check', arguments: {}});
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('stage');
      expect(parsed).toHaveProperty('pass');
      expect(parsed).toHaveProperty('findings');
      expect(Array.isArray(parsed.findings)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('clad_get_events returns an empty list when the log is missing', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({name: 'clad_get_events', arguments: {}});
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.events).toEqual([]);
      expect(parsed.note).toMatch(/no events log/i);
    } finally {
      await cleanup();
    }
  });

  test('clad_create_feature creates a new sharded feature file (F-084)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'new-login-flow', title: 'New login flow', status: 'planned'},
      });
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.slug).toBe('new-login-flow');
      expect(parsed.id).toMatch(/^F-[a-f0-9]{6}$/);
      // v0.3.10: filename is `<slug>-<hash>.yaml` so the hash entropy
      // distinguishes concurrent invocations.
      expect(parsed.path).toMatch(/spec\/features\/new-login-flow-[a-f0-9]{6}\.yaml$/);
      expect(result.isError).not.toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('clad_create_feature rejects an invalid slug as a tool error (F-084)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'INVALID-UPPERCASE'},
      });
      // MCP SDK's zod validation catches the regex mismatch and returns
      // the rejection as content rather than transport error.
      // Either path is acceptable; the test asserts the call did not
      // produce a successful new feature file.
      const content = result.content as Array<{text?: string}> | undefined;
      const text = content?.[0]?.text ?? '';
      const isError = result.isError === true;
      expect(isError || /invalid|validation/i.test(text)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('clad_create_scenario creates a new sharded scenario file (F-087, v0.3.12)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_create_scenario',
        arguments: {
          slug: 'checkout-happy-path',
          title: 'Checkout happy path',
          features: ['F-001', 'F-a3f9c2'],
        },
      });
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.slug).toBe('checkout-happy-path');
      expect(parsed.id).toMatch(/^S-[a-f0-9]{6}$/);
      expect(parsed.path).toMatch(/spec\/scenarios\/checkout-happy-path-[a-f0-9]{6}\.yaml$/);
      expect(result.isError).not.toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('clad_get_events tails the log when it exists', async () => {
    writeFileSync(
      join(dir, '.cladding', 'events.log.jsonl'),
      `${JSON.stringify({type: 'feature_activated', id: 'e1'})}\n${JSON.stringify({type: 'gate_run', id: 'e2'})}\n`,
    );
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({name: 'clad_get_events', arguments: {limit: 5}});
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.events).toHaveLength(2);
      expect(parsed.events[1].type).toBe('gate_run');
    } finally {
      await cleanup();
    }
  });

  test('reading the spec resource returns spec.yaml content', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.readResource({uri: RESOURCE_URIS.spec});
      expect(result.contents).toHaveLength(1);
      const content = result.contents[0] as {text: string; mimeType: string};
      expect(content.mimeType).toBe('application/json');
      const parsed = JSON.parse(content.text);
      expect(parsed.project.name).toBe('probe');
      expect(parsed.features).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });

  test('reading the audit resource returns empty text when missing', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.readResource({uri: RESOURCE_URIS.audit});
      const content = result.contents[0] as {text: string};
      expect(content.text).toBe('');
    } finally {
      await cleanup();
    }
  });

  test('getPrompt returns the persona body wrapped as an MCP message', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.getPrompt({
        name: 'reviewer',
        arguments: {featureId: 'F-001'},
      });
      expect(result.messages).toHaveLength(1);
      const msg = result.messages[0];
      expect(msg.role).toBe('user');
      const text = (msg.content as {type: string; text: string}).text;
      expect(text).toContain('Active feature: F-001');
      // The persona body should also be present.
      expect(text.length).toBeGreaterThan(100);
    } finally {
      await cleanup();
    }
  });
});
