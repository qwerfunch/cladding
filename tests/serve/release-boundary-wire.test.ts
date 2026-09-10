// Cladding · Spec 0.2 · MCP wire evidence for the release-boundary ledger rows.
//
// The validation ledger promotes MCP01, MCP03, MCP05, MCP06, MCP07 and MCP10 to
// validation-active, and a promoted row must point at a test that actually runs
// the wire. These are those tests. Each one drives a real in-memory MCP client
// against `buildServer`, so what is asserted is the negotiated protocol surface
// rather than a kernel function the transport happens to call.
//
// Three boundaries are deliberately recorded rather than asserted here:
//   • MCP05's rollback half. `buildServer` exposes no fault-injection seam, so
//     an interrupted apply cannot be produced over the wire. Replay and stale
//     rejection are wire-provable and asserted below; rollback stays with the
//     kernel contract tests `tests/spec/edit.test.ts` T04 and U03.
//   • MCP01's pre-initialize rejection. The SDK's `Client.connect` performs the
//     initialize exchange itself, so a pre-init request needs raw framing the
//     in-memory pair does not offer. The negotiated result is asserted instead.
//   • MCP03's reach. Parity holds for every tool that emits structuredContent;
//     read tools emit text only in 0.10.0 — outputSchema for read tools is a
//     0.10.x candidate because it moves the catalog byte pin.

import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Validator} from 'jsonschema';
import {afterEach, describe, expect, test} from 'vitest';

import {clearAuditObserversForTesting} from '../../src/hitl/audit.js';
import {buildServer} from '../../src/serve/server.js';

const temporary: string[] = [];

interface Pair {
  readonly client: Client;
  readonly cleanup: () => Promise<void>;
}

/** One in-memory host/server pair; every test drives the real negotiated wire. */
async function makePair(cwd: string): Promise<Pair> {
  const server = buildServer({cwd, name: 'cladding-release-boundary', version: '0.0.0-test'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'release-boundary-client', version: '0.0.0-test'});
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** A schema 0.2 workspace with two independent shards, mirroring the F4 fixture. */
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-mcp-boundary-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, '.cladding'), {recursive: true});
  writeFileSync(
    join(root, 'spec.yaml'),
    'schema: "0.2"\nproject:\n  name: boundary\n  language: typescript\n  purpose: Keep release evidence checkable.\n  assurance_level: L2\n  scenario_policy: advisory\n',
  );
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities:\n  - id: governance\n    title: Governance\n    outcome: Keep edits safe.\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  shard(root, 'one-aaaaaaaa.yaml', 'F-aaaaaaaa', 'One');
  shard(root, 'two-bbbbbbbb.yaml', 'F-bbbbbbbb', 'Two');
  return root;
}

function shard(root: string, name: string, id: string, title: string): void {
  writeFileSync(join(root, 'spec', 'features', name), [
    `id: ${id}`, `title: ${title}`, 'status: planned', `purpose: ${title} keeps its contract clear.`,
    'modules: []', 'depends_on: []', 'capability_refs: [governance]', 'acceptance_criteria:',
    '  - id: AC-cccccccc', '    kind: behavior',
    '    statement: The system shall keep edits recoverable.', '',
  ].join('\n'));
}

/** Byte-exact workspace census; `.cladding` is runtime state, not spec authority. */
function manifest(root: string, path: string = root): readonly {readonly path: string; readonly bytes: string}[] {
  return readdirSync(path, {withFileTypes: true})
    .filter((entry) => entry.name !== '.cladding')
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) return manifest(root, absolute);
      return [{path: absolute.slice(root.length + 1), bytes: readFileSync(absolute).toString('base64')}];
    });
}

function payload(result: unknown): Record<string, unknown> {
  const typed = result as {readonly content?: unknown; readonly structuredContent?: unknown};
  const text = (typed.content as Array<{readonly text: string}>)[0]!.text;
  return JSON.parse(text) as Record<string, unknown>;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
  clearAuditObserversForTesting();
});

describe('Spec 0.2 release-boundary MCP wire scenarios', () => {
  test('[covers:F-0a29d024/AC-bd12a73c] MCP01 negotiates a named server with dynamic tool listing over the wire', async () => {
    const {client, cleanup} = await makePair(workspace());
    try {
      expect(client.getServerVersion()).toMatchObject({name: 'cladding-release-boundary', version: '0.0.0-test'});
      expect(client.getServerCapabilities()?.tools?.listChanged).toBe(true);
      const tools = (await client.listTools()).tools;
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((tool) => tool.name)).toContain('clad_get_events');
    } finally {
      await cleanup();
    }
  });

  // Parity holds for every tool that emits structuredContent; read tools emit
  // text only in 0.10.0 — outputSchema for read tools is a 0.10.x candidate
  // because it moves the catalog byte pin.
  test('[covers:F-0a29d024/AC-bd12a73c] MCP03 returns identical text and structured content validated by the declared output schema', async () => {
    const root = workspace();
    writeFileSync(
      join(root, '.cladding', 'events.log.jsonl'),
      `${JSON.stringify({type: 'feature_activated', id: 'e1'})}\n${JSON.stringify({type: 'gate_run', id: 'e2'})}\n`,
    );
    const {client, cleanup} = await makePair(root);
    try {
      const tools = (await client.listTools()).tools;
      const schema = tools.find((tool) => tool.name === 'clad_get_events')?.outputSchema;
      expect(schema, 'clad_get_events declares an output schema').toBeDefined();
      const result = await client.callTool({name: 'clad_get_events', arguments: {limit: 5}});
      const text = payload(result);
      // Parity is the MCP03 claim: the duplicated channels must not diverge.
      expect(result.structuredContent).toEqual(text);
      const validation = new Validator().validate(text, schema as object);
      expect(validation.errors.map((error) => error.stack)).toEqual([]);
      expect((text.events as unknown[]).length).toBe(2);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1201] MCP05 rejects a replayed apply with stale input revisions and leaves every workspace byte unchanged', async () => {
    const root = workspace();
    const {client, cleanup} = await makePair(root);
    try {
      const operations = [{kind: 'feature.set_title', featureId: 'F-aaaaaaaa', title: 'One revised'}];
      const prepared = payload(await client.callTool({name: 'clad_prepare_spec_edit', arguments: {operations}}));
      expect(prepared.ok).toBe(true);
      const revisions = prepared.input_revisions as Record<string, string>;
      const applied = payload(await client.callTool({
        name: 'clad_edit_spec',
        arguments: {operations, input_revisions: revisions},
      }));
      expect(applied.ok).toBe(true);
      expect(readFileSync(join(root, 'spec', 'features', 'one-aaaaaaaa.yaml'), 'utf8')).toContain('One revised');

      const before = manifest(root);
      const replayed = payload(await client.callTool({
        name: 'clad_edit_spec',
        arguments: {operations: [{kind: 'feature.set_purpose', featureId: 'F-aaaaaaaa', purpose: 'A replayed writer must be stale.'}], input_revisions: revisions},
      }));
      expect(replayed.ok).toBe(false);
      expect(replayed.code).toBe('STALE_INPUT');
      expect(manifest(root)).toEqual(before);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1201] MCP06 applies two separately prepared different-shard edits over two clients', async () => {
    const root = workspace();
    const left = await makePair(root);
    const right = await makePair(root);
    try {
      const leftOperations = [{kind: 'feature.set_title', featureId: 'F-aaaaaaaa', title: 'Left revised'}];
      const rightOperations = [{kind: 'feature.set_title', featureId: 'F-bbbbbbbb', title: 'Right revised'}];
      // Both hosts prepare BEFORE either applies: this is the concurrent case,
      // not two sequential edits dressed up as one.
      const leftPrepared = payload(await left.client.callTool({name: 'clad_prepare_spec_edit', arguments: {operations: leftOperations}}));
      const rightPrepared = payload(await right.client.callTool({name: 'clad_prepare_spec_edit', arguments: {operations: rightOperations}}));
      const leftApplied = payload(await left.client.callTool({
        name: 'clad_edit_spec',
        arguments: {operations: leftOperations, input_revisions: leftPrepared.input_revisions},
      }));
      const rightApplied = payload(await right.client.callTool({
        name: 'clad_edit_spec',
        arguments: {operations: rightOperations, input_revisions: rightPrepared.input_revisions},
      }));
      expect(leftApplied.ok).toBe(true);
      expect(rightApplied.ok).toBe(true);
      expect(readFileSync(join(root, 'spec', 'features', 'one-aaaaaaaa.yaml'), 'utf8')).toContain('Left revised');
      expect(readFileSync(join(root, 'spec', 'features', 'two-bbbbbbbb.yaml'), 'utf8')).toContain('Right revised');
    } finally {
      await left.cleanup();
      await right.cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1201] MCP06 rejects a second client editing the same shard against a stale revision', async () => {
    const root = workspace();
    const left = await makePair(root);
    const right = await makePair(root);
    try {
      const leftOperations = [{kind: 'feature.set_title', featureId: 'F-aaaaaaaa', title: 'First writer'}];
      const rightOperations = [{kind: 'feature.set_purpose', featureId: 'F-aaaaaaaa', purpose: 'The second writer must be stale.'}];
      const leftPrepared = payload(await left.client.callTool({name: 'clad_prepare_spec_edit', arguments: {operations: leftOperations}}));
      const rightPrepared = payload(await right.client.callTool({name: 'clad_prepare_spec_edit', arguments: {operations: rightOperations}}));
      expect(payload(await left.client.callTool({
        name: 'clad_edit_spec',
        arguments: {operations: leftOperations, input_revisions: leftPrepared.input_revisions},
      })).ok).toBe(true);
      const before = manifest(root);
      const conflicted = payload(await right.client.callTool({
        name: 'clad_edit_spec',
        arguments: {operations: rightOperations, input_revisions: rightPrepared.input_revisions},
      }));
      expect(conflicted.ok).toBe(false);
      expect(conflicted.code).toBe('STALE_INPUT');
      expect(manifest(root)).toEqual(before);
    } finally {
      await left.cleanup();
      await right.cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1203] MCP07 refuses traversal, absolute, and path-shaped identifiers without writing to the workspace', async () => {
    const root = workspace();
    const {client, cleanup} = await makePair(root);
    try {
      const before = manifest(root);
      const hostile = [
        '../../etc/passwd',
        '/etc/passwd',
        'spec/features/../../../etc/passwd',
        '../one-aaaaaaaa',
      ];
      for (const featureId of hostile) {
        const operations = [{kind: 'feature.set_title', featureId, title: 'Never written'}];
        const prepared = payload(await client.callTool({name: 'clad_prepare_spec_edit', arguments: {operations}}));
        expect(prepared.ok, `prepare must refuse ${featureId}`).toBe(false);
        const applied = payload(await client.callTool({
          name: 'clad_edit_spec',
          arguments: {operations, input_revisions: {}},
        }));
        expect(applied.ok, `apply must refuse ${featureId}`).toBe(false);
      }
      // The refusal has to be silent on disk, not merely negative in its answer.
      expect(manifest(root)).toEqual(before);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0a29d024/AC-bd12a73c] MCP10 completes a create, begin, and read cycle for a tools-only host with no notification handler', async () => {
    const root = workspace();
    // A tools-only host: no resources, no prompts, no subscription, and no
    // notification handler registered. Nothing below may depend on those.
    const server = buildServer({cwd: root, name: 'cladding-tools-only', version: '0.0.0-test'});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({name: 'tools-only-client', version: '0.0.0-test'}, {capabilities: {}});
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const created = payload(await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'tools-only-cycle',
          title: 'Tools only cycle',
          purpose: 'Prove a tools-only host can complete a whole cycle.',
          capability_refs: [],
          design_impact: {classification: 'none', rationale: 'wire-only fixture feature'},
          acceptance_criteria: [{kind: 'behavior', statement: 'The system shall complete a tools-only cycle.'}],
        },
      }));
      const featureId = created.id as string;
      expect(featureId).toMatch(/^F-[a-f0-9]{8}$/);
      const begun = payload(await client.callTool({name: 'clad_begin', arguments: {feature: featureId}}));
      expect(begun.ok).toBe(true);
      const read = payload(await client.callTool({name: 'clad_get_feature', arguments: {id: featureId}}));
      expect(JSON.stringify(read)).toContain(featureId);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
