// Cladding · unit tests for assess_intent MCP tool (0.4.13 PR-D.1, F-b426b0)
//
// Exercises the MCP wire path: client → InMemoryTransport → server →
// classifyIntent → JSON-encoded text response. Verifies AC-006/AC-007
// (deterministic, dev-new shape) and the featureCandidates branch.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {buildServer} from '../../src/serve/server.js';

interface ToolText {
  type: 'text';
  text: string;
}
interface ToolResult {
  content: ToolText[];
  isError?: boolean;
}

const SPEC_WITH_FEATURES = `schema: "0.1"
project:
  name: probe
  language: typescript
features:
  - id: F-a11111
    slug: login-flow
    title: User login flow
    status: planned
    modules: []
  - id: F-b22222
    slug: logout-handler
    title: User logout handler
    status: planned
    modules: []
  - id: F-c33333
    slug: payment-checkout
    title: Payment checkout
    status: planned
    modules: []
`;

interface Pair {
  client: Client;
  cleanup: () => Promise<void>;
}

async function spawnServer(cwd: string): Promise<Pair> {
  const server = buildServer({cwd});
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'probe', version: '0.0.0'}, {capabilities: {}});
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('assess_intent MCP tool — wire path', () => {
  let dir: string;
  let pair: Pair;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'clad-assess-intent-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_WITH_FEATURES);
    pair = await spawnServer(dir);
  });
  afterEach(async () => {
    await pair.cleanup();
    rmSync(dir, {recursive: true, force: true});
  });

  test('tool is listed', async () => {
    const tools = await pair.client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('assess_intent');
  });

  test('dev-new prompt returns {intent: dev-new, suggestedAction: clad_create_feature}', async () => {
    const res = (await pair.client.callTool({
      name: 'assess_intent',
      arguments: {promptText: 'add a logout endpoint'},
    })) as ToolResult;
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.intent).toBe('dev-new');
    expect(payload.suggestedAction).toBe('clad_create_feature');
    expect(payload.confidence).toBe('high');
  });

  test('dev-modify prompt returns featureCandidates ranked from spec', async () => {
    const res = (await pair.client.callTool({
      name: 'assess_intent',
      arguments: {promptText: 'fix the login bug'},
    })) as ToolResult;
    const payload = JSON.parse(res.content[0].text);
    expect(payload.intent).toBe('dev-modify');
    expect(payload.suggestedAction).toBe('enter_work');
    expect(payload.featureCandidates).toBeDefined();
    expect(payload.featureCandidates[0].slug).toBe('login-flow');
  });

  test('non-dev prompt returns silent', async () => {
    const res = (await pair.client.callTool({
      name: 'assess_intent',
      arguments: {promptText: 'run the dev server on port 3000'},
    })) as ToolResult;
    const payload = JSON.parse(res.content[0].text);
    expect(payload.intent).toBe('non-dev');
    expect(payload.suggestedAction).toBe('silent');
  });

  test('determinism — two identical calls return identical payloads', async () => {
    const call = async () =>
      (await pair.client.callTool({
        name: 'assess_intent',
        arguments: {promptText: 'fix the login flow bug'},
      })) as ToolResult;
    const a = JSON.parse((await call()).content[0].text);
    const b = JSON.parse((await call()).content[0].text);
    expect(a).toEqual(b);
  });

  test('ambiguous prompt returns silent (low confidence)', async () => {
    const res = (await pair.client.callTool({
      name: 'assess_intent',
      arguments: {promptText: 'hello there'},
    })) as ToolResult;
    const payload = JSON.parse(res.content[0].text);
    expect(payload.intent).toBe('ambiguous');
    expect(payload.confidence).toBe('low');
    expect(payload.suggestedAction).toBe('silent');
  });
});

describe('assess_intent — spec absent (cladding not initialised)', () => {
  let dir: string;
  let pair: Pair;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'clad-assess-intent-nospec-'));
    // Intentionally no spec.yaml — classify still works, just no
    // featureCandidates.
    pair = await spawnServer(dir);
  });
  afterEach(async () => {
    await pair.cleanup();
    rmSync(dir, {recursive: true, force: true});
  });

  test('still classifies; featureCandidates absent', async () => {
    const res = (await pair.client.callTool({
      name: 'assess_intent',
      arguments: {promptText: 'fix the bug'},
    })) as ToolResult;
    const payload = JSON.parse(res.content[0].text);
    expect(payload.intent).toBe('dev-modify');
    expect(payload.featureCandidates).toBeUndefined();
  });
});
