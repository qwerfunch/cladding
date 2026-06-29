// Cladding · unit tests for src/serve/server.ts
//
// Exercises the v0.2.24 MCP server through an in-process Client paired
// over InMemoryTransport. The tests check that:
//   - all four tools are listed and callable
//   - the three resources are listed and readable
//   - all five persona prompts are listed (+ the 0.6.0 alias prompts)
//   - clad_get_feature gracefully reports an unknown id
//   - clad_run_check returns the drift report shape
//
// Sampling-based dispatch (v0.2.25) is out of scope here. This file is
// concerned only with the read surface of `clad serve`.

import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {buildServer, PERSONA_IDS, PERSONA_PROMPT_ALIASES, RESOURCE_URIS, TOOL_NAMES} from '../../src/serve/server.js';

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

  test('listPrompts surfaces every persona id plus the 0.6.0 alias prompts', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {prompts} = await client.listPrompts();
      const names = prompts.map((p) => p.name).sort();
      expect(names).toEqual(
        [...PERSONA_IDS, ...Object.keys(PERSONA_PROMPT_ALIASES)].sort(),
      );
      // Alias prompts say so in the description (hosts read it).
      const librarian = prompts.find((p) => p.name === 'librarian');
      expect(librarian?.description).toContain("'librarian' is now 'planner'");
    } finally {
      await cleanup();
    }
  });

  test("getPrompt on the deprecated 'librarian' name serves the planner persona body", async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const aliased = await client.getPrompt({name: 'librarian', arguments: {}});
      const canonical = await client.getPrompt({name: 'planner', arguments: {}});
      const text = (name: typeof aliased) =>
        (name.messages[0].content as {type: string; text: string}).text;
      expect(text(aliased)).toBe(text(canonical));
      expect(text(aliased)).toContain('Planner');
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

  test('clad_changelog format=catalog renders the spec catalog without a git range (F-904495a5)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_changelog',
        arguments: {format: 'catalog'},
      });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.schema_version).toBe(1);
      expect(parsed.format).toBe('catalog');
      // The catalog is the prose comprehension surface — titles + AC sentences.
      expect(parsed.content).toContain('# probe — capability catalog');
      expect(parsed.content).toContain('### alpha');
      expect(parsed.content).toContain('probe AC for serve tests');
    } finally {
      await cleanup();
    }
  });

  test('clad_changelog reports an unknown since ref as isError, never an empty manifest (F-904495a5)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      // The temp project dir is not a git repository, so any ref is unresolvable.
      const result = await client.callTool({
        name: 'clad_changelog',
        arguments: {since: 'no-such-ref'},
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{text: string}>)[0].text).toContain('no-such-ref');
    } finally {
      await cleanup();
    }
  });

  test('read surfaces degrade gracefully when spec.yaml is absent (no crash)', async () => {
    // A project that has not run `clad init` yet — spec.yaml is absent, so
    // loadSpec throws. The read tools must return an isError reply (and the
    // spec resource an error payload), not crash the MCP call.
    const bare = mkdtempSync(join(tmpdir(), 'clad-serve-bare-'));
    const {client, cleanup} = await makePair(bare);
    try {
      const list = await client.callTool({name: 'clad_list_features', arguments: {}});
      expect(list.isError).toBe(true);
      expect((list.content as Array<{text: string}>)[0].text).toContain('spec not loaded');

      const get = await client.callTool({name: 'clad_get_feature', arguments: {id: 'F-001'}});
      expect(get.isError).toBe(true);

      const res = await client.readResource({uri: RESOURCE_URIS.spec});
      const text = (res.contents as Array<{text: string}>)[0].text;
      expect(JSON.parse(text).error).toContain('spec not loaded');
    } finally {
      await cleanup();
      rmSync(bare, {recursive: true, force: true});
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

  // B2 (No-Vacuous-Green efficiency) — terse by default keeps the gate result
  // cheap as it re-enters the agent loop each turn; verbose opt-in keeps full debuggability.
  test('clad_run_check is terse by default (counts + top-3); verbose returns the full report', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const terse = await client.callTool({name: 'clad_run_check', arguments: {}});
      const t = JSON.parse((terse.content as Array<{type: string; text: string}>)[0].text);
      expect(t).toHaveProperty('errorCount');
      expect(t).toHaveProperty('warnCount');
      expect(Array.isArray(t.findings)).toBe(true);
      expect(t.findings.length).toBeLessThanOrEqual(3);

      const full = await client.callTool({name: 'clad_run_check', arguments: {verbose: true}});
      const f = JSON.parse((full.content as Array<{type: string; text: string}>)[0].text);
      // verbose is the raw DriftReport — has findings but NOT the terse-only counts
      expect(f).toHaveProperty('findings');
      expect(f).not.toHaveProperty('errorCount');
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
      expect(parsed.id).toMatch(/^F-[a-f0-9]{8}$/);
      // v0.3.10: filename is `<slug>-<hash>.yaml` so the hash entropy
      // distinguishes concurrent invocations.
      expect(parsed.path).toMatch(/spec\/features\/new-login-flow-[a-f0-9]{8}\.yaml$/);
      expect(result.isError).not.toBe(true);
    } finally {
      await cleanup();
    }
  });

  // Lever ① — clad_create_feature surfaces a malformed-EARS AC as an MCP error
  // AT CREATION (the end-to-end path that makes the shift-left lever actually
  // reach the agent), and writes no shard.
  test('clad_create_feature REJECTS a malformed-EARS AC — isError + precise message, no shard written', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'bad-ears-flow',
          title: 'x',
          acceptance_criteria: [{ears: 'ubiquitous', condition: 'when the user logs in', text: 't'}],
        },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      expect(text).toMatch(/EARS-shape issue/);
      expect(text).toMatch(/ubiquitous.*but condition is present/);
      // fail-before-write: no bad-ears-flow shard landed on disk
      const featuresDir = join(dir, 'spec', 'features');
      const landed = existsSync(featuresDir) ? readdirSync(featuresDir).filter((f) => f.startsWith('bad-ears-flow')) : [];
      expect(landed).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  // Phase 2 — clad_author_oracle records a host-authored impl-blind oracle:
  // writes the test, records provenance, stamps oracle_refs onto the AC.
  test('clad_author_oracle records the oracle + provenance + stamps oracle_refs', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const created = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'widget', title: 'Widget', status: 'done', acceptance_criteria: [{text: 'does the thing'}]},
      });
      const createdParsed = JSON.parse((created.content as Array<{type: string; text: string}>)[0].text);
      const featureId = createdParsed.id as string;
      const shardPath = createdParsed.path as string; // createFeature returns an absolute path
      // AC ids are auto-assigned (AC-<hash6> or AC-NNN) — read the real one back.
      const acId = readFileSync(shardPath, 'utf8').match(/id:\s*(AC-\S+)/)?.[1] as string;

      const result = await client.callTool({
        name: 'clad_author_oracle',
        arguments: {
          featureId,
          acId,
          body: "import {test, expect} from 'vitest';\ntest('x', () => expect(1).toBe(1));",
          readManifest: ['spec:acceptance_criteria'],
          blind: true,
          authorName: 'blind-subagent',
        },
      });
      const parsed = JSON.parse((result.content as Array<{type: string; text: string}>)[0].text);
      expect(parsed.ok).toBe(true);
      expect(result.isError).not.toBe(true);
      expect(parsed.oraclePath).toBe(`tests/oracle/${featureId}.${acId}.test.ts`);
      // oracle_refs stamped onto the AC shard
      expect(readFileSync(shardPath, 'utf8')).toContain(parsed.oraclePath);
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
      expect(parsed.id).toMatch(/^S-[a-f0-9]{8}$/);
      expect(parsed.path).toMatch(/spec\/scenarios\/checkout-happy-path-[a-f0-9]{8}\.yaml$/);
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

// ─── F-570a3f — MCP structural channel ───

describe('MCP structural channel (F-570a3f)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-serve-gate-'));
    writeFileSync(join(dir, 'spec.yaml'), MINIMAL_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('clad_create_feature result carries schema_version and a gate field (JSON, not appended text)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const res = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'gate-footer-probe', acceptance_criteria: [{ears: 'ubiquitous', text: 'probe'}]},
      });
      const text = (res.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text) as {schema_version?: number; gate?: {pass: boolean; findings: unknown[]}};
      expect(parsed.schema_version).toBe(1);
      expect(parsed.gate).toBeDefined();
      expect(typeof parsed.gate!.pass).toBe('boolean');
      expect(Array.isArray(parsed.gate!.findings)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('clad_run_gate runs the real pipeline and returns the untruncated JSON outcome', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const res = await client.callTool({name: 'clad_run_gate', arguments: {tier: 'pre-commit'}});
      const text = (res.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text) as {schema_version?: number; tier?: string; worst?: number; stages?: unknown[]};
      expect(parsed.schema_version).toBe(1);
      expect(parsed.tier).toBe('pre-commit');
      expect(typeof parsed.worst).toBe('number');
      expect(Array.isArray(parsed.stages)).toBe(true);
    } finally {
      await cleanup();
    }
  }, 60_000);
});

// ─── F-551a1c — out-of-policy oracle recording is labeled voluntary ───

describe('voluntary oracle labeling (F-551a1c)', () => {
  test('recording an oracle for an AC no policy requires carries voluntary:true + a cost note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-serve-vol-'));
    writeFileSync(join(dir, 'spec.yaml'), MINIMAL_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const {client, cleanup} = await makePair(dir);
    try {
      const created = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'vol-probe', status: 'done', acceptance_criteria: [{ears: 'ubiquitous', text: 'probe', test_refs: ['spec.yaml']}]},
      });
      const feature = JSON.parse((created.content as Array<{type: string; text: string}>)[0].text) as {id: string; path: string};
      const shard = readFileSync(feature.path, 'utf8'); // result path is already absolute
      const acId = /id: (AC-[0-9a-f]+)/.exec(shard)![1];
      const res = await client.callTool({
        name: 'clad_author_oracle',
        arguments: {featureId: feature.id, acId, body: 'import {test} from "vitest"; test("t", () => {});', readManifest: ['spec brief'], blind: true, authorName: 'probe-blind'},
      });
      const parsed = JSON.parse((res.content as Array<{type: string; text: string}>)[0].text) as {voluntary?: boolean; cost_note?: string};
      expect(parsed.voluntary).toBe(true);
      expect(parsed.cost_note).toContain('clad oracle --required');
    } finally {
      await cleanup();
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ─── F-d2c806 — clad_get_context over MCP ───

describe('clad_get_context (F-d2c806)', () => {
  test('returns the slice with schema_version; a miss is isError with the accepted forms', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-serve-ctx-'));
    writeFileSync(join(dir, 'spec.yaml'), MINIMAL_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('clad_get_context');
      const miss = await client.callTool({name: 'clad_get_context', arguments: {query: 'nope'}});
      expect(miss.isError).toBe(true);
      const parsed = JSON.parse((miss.content as Array<{type: string; text: string}>)[0].text) as {schema_version: number; not_found: string};
      expect(parsed.schema_version).toBe(1);
      expect(parsed.not_found).toBe('nope');
    } finally {
      await cleanup();
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ─── F-7794a6bc — clad_get_impact (blast radius) over MCP ───

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

describe('clad_get_impact (F-7794a6bc)', () => {
  test('clad_get_impact returns the blast-radius slice; a miss is isError', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-serve-impact-'));
    writeFileSync(join(dir, 'spec.yaml'), IMPACT_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('clad_get_impact');

      // Changing F-001 should surface F-002 (its dependent) + the regression tests.
      const hit = await client.callTool({name: 'clad_get_impact', arguments: {query: 'F-001'}});
      expect(hit.isError).toBeFalsy();
      const slice = JSON.parse((hit.content as Array<{type: string; text: string}>)[0].text) as {
        schema_version: number;
        focus: {id?: string};
        impacted: Array<{id: string}>;
        test_refs: string[];
      };
      expect(slice.schema_version).toBe(1);
      expect(slice.focus.id).toBe('F-001');
      expect(slice.impacted.map((i) => i.id)).toContain('F-002');
      expect(slice.test_refs).toContain('tests/dependent.test.ts#dependent works');

      // A module path fans out to its owners' radius too.
      const byModule = await client.callTool({name: 'clad_get_impact', arguments: {query: 'src/core.ts'}});
      expect(byModule.isError).toBeFalsy();
      const mslice = JSON.parse((byModule.content as Array<{type: string; text: string}>)[0].text) as {
        focus: {module?: string; owners?: string[]};
        impacted: Array<{id: string}>;
      };
      expect(mslice.focus.module).toBe('src/core.ts');
      expect(mslice.focus.owners).toContain('F-001');
      expect(mslice.impacted.map((i) => i.id)).toContain('F-002');

      const miss = await client.callTool({name: 'clad_get_impact', arguments: {query: 'nope'}});
      expect(miss.isError).toBe(true);
      const parsed = JSON.parse((miss.content as Array<{type: string; text: string}>)[0].text) as {
        schema_version: number;
        not_found: string;
      };
      expect(parsed.schema_version).toBe(1);
      expect(parsed.not_found).toBe('nope');
    } finally {
      await cleanup();
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ─── F-64a5c159 — clad_get_graph (live knowledge graph) over MCP ───

describe('clad_get_graph (F-64a5c159)', () => {
  test('clad_get_graph returns the live graph; a focus miss is isError', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-serve-graph-'));
    writeFileSync(join(dir, 'spec.yaml'), IMPACT_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('clad_get_graph');

      const all = await client.callTool({name: 'clad_get_graph', arguments: {}});
      expect(all.isError).toBeFalsy();
      const graph = JSON.parse((all.content as Array<{type: string; text: string}>)[0].text) as {
        schema_version: number;
        nodes: Array<{id: string}>;
        edges: unknown[];
      };
      expect(graph.schema_version).toBe(1);
      expect(graph.nodes.some((n) => n.id === 'feature:F-001')).toBe(true);
      expect(graph.edges.length).toBeGreaterThan(0);

      const focused = await client.callTool({name: 'clad_get_graph', arguments: {query: 'F-001', max_depth: 1}});
      expect(focused.isError).toBeFalsy();
      const sub = JSON.parse((focused.content as Array<{type: string; text: string}>)[0].text) as {
        nodes: Array<{id: string}>;
      };
      expect(sub.nodes.some((n) => n.id === 'feature:F-001')).toBe(true);

      const gmiss = await client.callTool({name: 'clad_get_graph', arguments: {query: 'nope'}});
      expect(gmiss.isError).toBe(true);
      const gparsed = JSON.parse((gmiss.content as Array<{type: string; text: string}>)[0].text) as {not_found: string};
      expect(gparsed.not_found).toBe('nope');
    } finally {
      await cleanup();
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
