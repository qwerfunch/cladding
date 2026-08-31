// Cladding · MCP tool-description budget (F-bc8ad013, mcp-description-diet)
//
// WHY this test exists:
//   A tool's `description` is not documentation you open on demand — the MCP
//   host injects EVERY registered description into the model's context on
//   EVERY session and re-reads them each agent-loop turn. Verbose descriptions
//   are therefore a resident per-turn tax, and they regrow silently: each edit
//   that "just adds one more clarifying clause" is invisible until the whole
//   surface has bloated into essays. This budget is the tripwire — a failing
//   assertion here is the only thing that stops the descriptions creeping back
//   up after the diet lands.
//
//   The budget: every clad_* tool description is capped at 800 chars, with
//   exactly ONE exemption — clad_author_oracle may run to 1,900. The oracle is
//   exempt because Gemini / generic-MCP hosts get NO skills files: for those
//   hosts the tool description is the ONLY copy of the impl-blind authoring
//   protocol, so trimming it would delete the protocol itself. The exemption is
//   earned, not a blank cheque — the last test pins that the protocol markers
//   survive inside the 1,900-char allowance.
//
// Access idiom: mirrors tests/serve/server.test.ts — an in-process MCP Client
// over InMemoryTransport, reading tool metadata off the public listTools()
// listing (the tool analogue of the listPrompts() description read at
// server.test.ts:111). listTools() never invokes a handler, so the descriptions
// are the same static strings the host would receive at registration time.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {buildServer} from '../../src/serve/server.js';

// The per-turn resident budget, in characters.
const PER_TOOL_CAP = 800;
// The single earned exemption: for skills-less hosts this description is the
// only carrier of the impl-blind oracle protocol.
const ORACLE_TOOL = 'clad_author_oracle';
const ORACLE_CAP = 1_900;
// The three worst offenders this diet trims hardest.
const TIGHT_CAP = 400;
const TIGHT_TOOLS = ['clad_create_feature', 'clad_changelog', 'clad_get_graph'] as const;

// Two robust literal substrings that carry the impl-blind protocol: the
// FRESH-sub-agent dispatch instruction and the never-the-implementation clause.
// If either disappears, the oracle exemption has been spent on something other
// than the protocol it exists to preserve.
const ORACLE_PROTOCOL_MARKERS = [
  'spawn a FRESH sub-agent given ONLY that brief',
  'never the implementation',
] as const;

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
        text: probe AC for description-budget tests
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

describe('serve/server — MCP description budget (F-bc8ad013)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-serve-budget-'));
    writeFileSync(join(dir, 'spec.yaml'), MINIMAL_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  // (a) — the whole resident surface fits the budget: ≤800 everywhere, with the
  // single earned ≤1,900 exemption for the oracle.
  test('[covers:F-bc8ad013/AC-56434559] every clad_* tool description is within budget (≤800, oracle ≤1,900)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      const cladTools = tools.filter((t) => t.name.startsWith('clad_'));
      expect(cladTools.length).toBeGreaterThan(0);
      for (const t of cladTools) {
        const len = (t.description ?? '').length;
        const cap = t.name === ORACLE_TOOL ? ORACLE_CAP : PER_TOOL_CAP;
        expect(
          len,
          `${t.name} description is ${len} chars (cap ${cap})`,
        ).toBeLessThanOrEqual(cap);
      }
    } finally {
      await cleanup();
    }
  });

  // (b) — the three tools this diet targets are trimmed hardest (≤400 each).
  test('clad_create_feature / clad_changelog / clad_get_graph are trimmed to ≤400 chars', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      for (const name of TIGHT_TOOLS) {
        const t = tools.find((x) => x.name === name);
        expect(t, `${name} must be a registered tool`).toBeDefined();
        const len = (t!.description ?? '').length;
        expect(
          len,
          `${name} description is ${len} chars (cap ${TIGHT_CAP})`,
        ).toBeLessThanOrEqual(TIGHT_CAP);
      }
    } finally {
      await cleanup();
    }
  });

  // (c) — the oracle exemption is earned: its ≤1,900 allowance must still carry
  // the impl-blind protocol, since for skills-less hosts this is its only copy.
  test('[covers:F-bc8ad013/AC-7f832957] clad_author_oracle still carries its impl-blind protocol markers', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      const oracle = tools.find((t) => t.name === ORACLE_TOOL);
      expect(oracle, `${ORACLE_TOOL} must be a registered tool`).toBeDefined();
      const desc = oracle!.description ?? '';
      for (const marker of ORACLE_PROTOCOL_MARKERS) {
        expect(
          desc,
          `${ORACLE_TOOL} description must retain protocol marker ${JSON.stringify(marker)}`,
        ).toContain(marker);
      }
    } finally {
      await cleanup();
    }
  });
});
