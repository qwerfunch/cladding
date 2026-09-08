// Cladding · F-6349870d — the server's refusal of legacy criterion fields names
// the schema 0.2 replacement.
//
// A host that sends `test_refs` (or any other legacy EARS field) to
// `clad_create_feature` on a schema 0.2 workspace used to be told only what is
// NOT accepted. The refusal now carries the cure: the covers token that opens a
// test title. Everything else about the wire stays put — the same 27 tools, the
// same refusal code — because this feature changes guidance, not behaviour.
//
// Covers:
//   AC-695f4712 — the refusal names the title token as the replacement, and the
//                 tool descriptions stop presenting test_refs as the binding.
//   AC-d8343efa — the tool set is unchanged (27 tools) and the refusal keeps its
//                 INVALID_OPERATION code, so no verdict path moves.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {buildServer} from '../../src/serve/server.js';

/** The declared wire surface this feature must not move (docs/design/spec-0.2). */
const DECLARED_TOOL_COUNT = 27;

interface Pair {
  readonly client: Client;
  readonly cleanup: () => Promise<void>;
}

async function makePair(cwd: string): Promise<Pair> {
  const server = buildServer({cwd, name: 'cladding-binding-guidance', version: '0.0.0-test'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'binding-guidance-client', version: '0.0.0-test'});
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

function payload(result: unknown): Record<string, unknown> {
  const content = (result as {content?: {type: string; text?: string}[]}).content ?? [];
  return JSON.parse(content[0]?.text ?? '{}') as Record<string, unknown>;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-binding-guidance-'));
  mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  mkdirSync(join(dir, '.cladding'), {recursive: true});
  writeFileSync(join(dir, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: binding-guidance', '  language: typescript',
    '  purpose: Tell a host how a test claims a criterion.', '  assurance_level: L2',
    '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(dir, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

describe('AC-695f4712 · a schema 0.2 creation request carrying test references is refused with the cure', () => {
  test('[covers:F-6349870d/AC-695f4712] test_refs on a criterion is refused with a message naming the title token', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const doc = payload(await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'legacy-refs',
          purpose: 'Prove the refusal names the replacement.',
          capability_refs: [],
          acceptance_criteria: [{
            kind: 'behavior',
            statement: 'The system shall refuse a legacy test reference.',
            test_refs: ['tests/legacy.test.ts'],
          }],
        },
      }));
      const message = String(doc.message ?? '');
      expect(doc.code).toBe('INVALID_OPERATION');
      expect(message).toContain('not accepted');
      expect(message).toContain('[covers:F-…/AC-…]');
      expect(message).toContain('starting its title');
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-6349870d/AC-695f4712] a legacy EARS field is refused with the same replacement sentence', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const doc = payload(await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'legacy-ears',
          purpose: 'Prove the refusal is shared by every legacy field.',
          capability_refs: [],
          acceptance_criteria: [{
            kind: 'behavior',
            statement: 'The system shall refuse a legacy EARS field.',
            ears: 'ubiquitous',
          }],
        },
      }));
      expect(doc.code).toBe('INVALID_OPERATION');
      expect(String(doc.message ?? '')).toContain('[covers:F-…/AC-…]');
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-6349870d/AC-695f4712] the schema and read-tool descriptions stop presenting test references as the only binding', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const tools = (await client.listTools()).tools;
      const create = tools.find((tool) => tool.name === 'clad_create_feature');
      expect(JSON.stringify(create?.inputSchema)).toContain('[covers:F-…/AC-…]');
      for (const name of ['clad_get_context', 'clad_get_impact']) {
        const description = tools.find((tool) => tool.name === name)?.description ?? '';
        expect(description).toContain('test binding');
      }
    } finally {
      await cleanup();
    }
  });
});

describe('AC-d8343efa · the guidance change leaves the wire surface where it was', () => {
  test('[covers:F-6349870d/AC-d8343efa] the server still registers exactly the declared tool set', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      expect((await client.listTools()).tools).toHaveLength(DECLARED_TOOL_COUNT);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-6349870d/AC-d8343efa] a well-formed schema 0.2 creation still succeeds', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const doc = payload(await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'well-formed',
          purpose: 'Prove the accepted path is untouched.',
          capability_refs: [],
          design_impact: {classification: 'none', rationale: 'guidance-only fixture feature'},
          acceptance_criteria: [{kind: 'behavior', statement: 'The system shall keep the accepted path open.'}],
        },
      }));
      expect(String(doc.id ?? '')).toMatch(/^F-[a-f0-9]{8}$/);
    } finally {
      await cleanup();
    }
  });
});
