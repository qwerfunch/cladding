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

import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync, existsSync, readdirSync, utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Validator} from 'jsonschema';
import {fileURLToPath} from 'node:url';
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

const NO_DESIGN_IMPACT = {classification: 'none', rationale: 'test-only internal feature'} as const;
const MUTATION_PACKET_BYTES = 16 * 1024;

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

/** Provides the child only ordinary process settings, never an LLM credential. */
function stdioClientEnv(): Record<string, string> {
  const providerKeys = new Set(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']);
  return Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value !== undefined && !providerKeys.has(key)),
  ) as Record<string, string>;
}

/** Captures every workspace entry so ingress rejection can prove zero writes. */
function workspaceManifest(root: string, directory: string = root): readonly {readonly path: string; readonly bytes: string}[] {
  return readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return [{path: `${path.slice(root.length + 1)}/`, bytes: '<directory>'}, ...workspaceManifest(root, path)];
      return [{path: path.slice(root.length + 1), bytes: readFileSync(path).toString('base64')}];
    });
}

/** Fills a valid typed edit field to one exact pre-normalization wire size. */
function editRequestAtWireBytes(bytes: number): {operations: Array<{kind: string; purpose: string}>; input_revisions: Record<string, string>} {
  const request = {operations: [{kind: 'project.set_purpose', purpose: ''}], input_revisions: {}};
  const padding = bytes - Buffer.byteLength(JSON.stringify(request));
  if (padding < 0) throw new Error('Requested typed edit packet is smaller than its schema envelope.');
  request.operations[0].purpose = 'x'.repeat(padding);
  return request;
}

/** Fills the one known begin field to one exact parsed-wire size. */
function beginRequestAtWireBytes(bytes: number): {feature: string} {
  const request = {feature: ''};
  const padding = bytes - Buffer.byteLength(JSON.stringify(request));
  if (padding < 0) throw new Error('Requested begin packet is smaller than its schema envelope.');
  request.feature = 'x'.repeat(padding);
  return request;
}

/** Verifies MCP's duplicated text/structured response against the discovered output schema. */
function expectDeclaredMutationPayload(
  tools: readonly {readonly name: string; readonly outputSchema?: object}[],
  name: string,
  result: unknown,
): Record<string, unknown> {
  const payloadResult = result as {readonly content?: unknown; readonly structuredContent?: unknown};
  expect(payloadResult.content).toBeDefined();
  const text = (payloadResult.content as Array<{readonly text: string}>)[0]!.text;
  const payload = JSON.parse(text) as Record<string, unknown>;
  expect(payloadResult.structuredContent).toEqual(payload);
  const schema = tools.find((tool) => tool.name === name)?.outputSchema;
  expect(schema).toBeDefined();
  const validation = new Validator().validate(payload, schema!);
  expect(validation.errors.map((error) => error.stack)).toEqual([]);
  return payload;
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

  test('[covers:F-073/AC-207] listTools surfaces every declared tool name through the MCP client', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([...TOOL_NAMES].sort());
      expect(names).toEqual(expect.arrayContaining([
        'clad_list_features',
        'clad_get_feature',
        'clad_run_check',
        'clad_get_events',
      ]));
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-073/AC-206] a generic client consumes a tool, resource, and prompt through the real clad serve stdio command without provider credentials', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../../bin/clad', import.meta.url)), 'serve'],
      cwd: dir,
      env: stdioClientEnv(),
      stderr: 'pipe',
    });
    const client = new Client({name: 'generic-stdio-proof', version: '0.0.0-test'});
    try {
      await client.connect(transport);

      const tool = await client.callTool({name: 'clad_list_features', arguments: {}});
      const toolBody = JSON.parse((tool.content as Array<{text: string}>)[0].text) as {
        total: number;
        features: {id: string}[];
      };
      expect(toolBody).toMatchObject({total: 2, features: [{id: 'F-001'}, {id: 'F-002'}]});

      const resource = await client.readResource({uri: RESOURCE_URIS.spec});
      const resourceBody = JSON.parse((resource.contents[0] as {text: string}).text) as {
        project: {name: string};
      };
      expect(resourceBody.project.name).toBe('probe');

      const prompt = await client.getPrompt({name: 'planner', arguments: {featureId: 'F-001'}});
      const promptText = (prompt.messages[0].content as {type: string; text: string}).text;
      expect(promptText).toContain('Planner');
      expect(promptText).toContain('Active feature: F-001');
    } finally {
      await client.close();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1203] typed edit discovery is the closed per-operation registry', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      const prepare = tools.find((tool) => tool.name === 'clad_prepare_spec_edit');
      const edit = tools.find((tool) => tool.name === 'clad_edit_spec');
      const events = tools.find((tool) => tool.name === 'clad_get_events');
      const prepareSchema = prepare?.inputSchema as {properties?: Record<string, unknown>} | undefined;
      const editSchema = edit?.inputSchema as {properties?: Record<string, unknown>} | undefined;
      expect((prepareSchema as {additionalProperties?: boolean} | undefined)?.additionalProperties).toBe(false);
      expect((editSchema as {additionalProperties?: boolean} | undefined)?.additionalProperties).toBe(false);
      expect(prepareSchema?.properties?.operations).toEqual(editSchema?.properties?.operations);
      const operations = prepareSchema?.properties?.operations as {
        items?: {oneOf?: Array<{properties?: Record<string, {const?: string}>; required?: string[]; additionalProperties?: boolean}>; anyOf?: Array<{properties?: Record<string, {const?: string}>; required?: string[]; additionalProperties?: boolean}>};
      };
      const variants = operations.items?.oneOf ?? operations.items?.anyOf ?? [];
      const begin = variants.find((variant) => variant.properties?.kind?.const === 'feature.begin');
      expect(begin?.required).toEqual(['kind', 'featureId']);
      expect(begin?.additionalProperties).toBe(false);
      expect(begin?.properties).not.toHaveProperty('status');
      expect(begin?.properties).not.toHaveProperty('path');
      const upgrade = variants.find((variant) => variant.properties?.kind?.const === 'project.upgrade_schema');
      expect(upgrade?.required).toEqual(['kind', 'resolutions']);
      expect(upgrade?.properties).toMatchObject({
        kind: {const: 'project.upgrade_schema'},
        resolutions: expect.objectContaining({type: 'object'}),
      });
      expect(JSON.stringify(upgrade)).toContain('previewDigest');
      expect(JSON.stringify(upgrade)).toContain('confirmed');
      expect(JSON.stringify(upgrade)).not.toContain('preview"');
      expect(editSchema?.properties?.context_revision).toMatchObject({pattern: '^[a-f0-9]{64}$'});
      expect(JSON.stringify(events?.outputSchema)).toContain('byte_limit');
      expect(JSON.stringify(events?.outputSchema)).toContain('oversized_events');
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-5283985e/AC-4a71e2] F4 mutating adapters advertise non-read-only annotations and executable result fields', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      for (const name of ['clad_edit_spec', 'clad_begin', 'clad_create_feature', 'clad_resolve_design_impact', 'clad_author_oracle', 'clad_create_scenario', 'clad_link_capability']) {
        const tool = tools.find((entry) => entry.name === name);
        expect(tool?.annotations?.readOnlyHint).toBe(false);
        expect((tool?.inputSchema as {additionalProperties?: boolean} | undefined)?.additionalProperties).toBe(false);
        expect(tool?.outputSchema).toMatchObject({properties: expect.objectContaining({ok: expect.anything(), code: expect.anything(), message: expect.anything()})});
      }
      const create = tools.find((entry) => entry.name === 'clad_create_feature')?.outputSchema as {properties?: Record<string, unknown>} | undefined;
      expect(create?.properties).toMatchObject({id: expect.anything(), slug: expect.anything(), path: expect.anything(), gate: expect.anything()});
      const resolve = tools.find((entry) => entry.name === 'clad_resolve_design_impact');
      const link = tools.find((entry) => entry.name === 'clad_link_capability');
      expect(tools.find((entry) => entry.name === 'clad_create_feature')?.annotations?.idempotentHint).toBe(false);
      expect(resolve?.annotations?.idempotentHint).toBe(true);
      expect(link?.annotations?.idempotentHint).toBe(true);
      expect((resolve?.outputSchema as {properties?: Record<string, unknown>} | undefined)?.properties).toMatchObject({feature: expect.anything(), changed: expect.anything(), path: expect.anything(), gate: expect.anything()});
      expect((link?.outputSchema as {properties?: Record<string, unknown>} | undefined)?.properties).toMatchObject({capability: expect.anything(), feature: expect.anything(), created: expect.anything(), alreadyLinked: expect.anything(), path: expect.anything(), gate: expect.anything()});
      const createInput = tools.find((entry) => entry.name === 'clad_create_feature')?.inputSchema as {properties?: {acceptance_criteria?: {items?: {additionalProperties?: boolean}}; design_impact?: {anyOf?: Array<{additionalProperties?: boolean}>; oneOf?: Array<{additionalProperties?: boolean}>}}} | undefined;
      expect(createInput?.properties?.acceptance_criteria?.items?.additionalProperties).toBe(false);
      const designVariants = createInput?.properties?.design_impact?.anyOf ?? createInput?.properties?.design_impact?.oneOf;
      expect(designVariants?.every((variant) => variant.additionalProperties === false)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1203] F4/F5 mutation families reject unknown 17 KiB transport padding before any workspace write', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const mutations: readonly [string, Record<string, unknown>][] = [
        ['clad_edit_spec', {operations: [{kind: 'feature.begin', featureId: 'F-001'}], input_revisions: {}}],
        ['clad_begin', {feature: 'F-001'}],
        ['clad_create_feature', {slug: 'padding-create'}],
        ['clad_resolve_design_impact', {feature: 'F-001'}],
        ['clad_author_oracle', {featureId: 'F-001', acId: 'AC-001', body: 'export {};', readManifest: []}],
        ['clad_create_scenario', {slug: 'padding-scenario'}],
        ['clad_link_capability', {capability: 'padding-capability', feature: 'F-001'}],
        ['clad_ingest_receipt', {receipt_yaml: 'schema: invalid'}],
        ['clad_signoff', {feature: 'F-001', claim: 'audit', criterion: 'AC-001', result: 'pass'}],
      ];
      for (const [name, request] of mutations) {
        const before = workspaceManifest(dir);
        const result = await client.callTool({name, arguments: {...request, padding: 'x'.repeat(17 * 1024)}});
        const error = result as {isError?: boolean; content?: Array<{text?: string}>};
        expect(error.isError).toBe(true);
        expect(error.content?.[0]?.text).toMatch(/input validation error|unrecognized key/i);
        expect(workspaceManifest(dir)).toEqual(before);
      }
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1203] F4 core edits enforce exact parsed-wire bytes before snake-case normalization', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      const call = async (name: string, request: Record<string, unknown>): Promise<Record<string, unknown>> =>
        expectDeclaredMutationPayload(tools, name, await client.callTool({name, arguments: request}));
      const atLimitEdit = editRequestAtWireBytes(MUTATION_PACKET_BYTES);
      const atLimitBegin = beginRequestAtWireBytes(MUTATION_PACKET_BYTES);
      expect(Buffer.byteLength(JSON.stringify(atLimitEdit))).toBe(MUTATION_PACKET_BYTES);
      expect(Buffer.byteLength(JSON.stringify(atLimitBegin))).toBe(MUTATION_PACKET_BYTES);
      for (const [name, request] of [['clad_edit_spec', atLimitEdit], ['clad_begin', atLimitBegin]] as const) {
        const before = workspaceManifest(dir);
        const payload = await call(name, request);
        expect(payload.message).not.toMatch(/exceeds the 16 KiB mutation limit/i);
        expect(workspaceManifest(dir)).toEqual(before);
      }

      const justOverWireEdit = editRequestAtWireBytes(MUTATION_PACKET_BYTES + 1);
      const normalizedEdit = {operations: justOverWireEdit.operations, inputRevisions: justOverWireEdit.input_revisions};
      expect(Buffer.byteLength(JSON.stringify(justOverWireEdit))).toBe(MUTATION_PACKET_BYTES + 1);
      expect(Buffer.byteLength(JSON.stringify(normalizedEdit))).toBe(MUTATION_PACKET_BYTES);
      const justOverBegin = beginRequestAtWireBytes(MUTATION_PACKET_BYTES + 1);
      for (const [name, request] of [['clad_edit_spec', justOverWireEdit], ['clad_begin', justOverBegin]] as const) {
        const before = workspaceManifest(dir);
        const payload = await call(name, request);
        expect(payload).toMatchObject({ok: false, code: 'INVALID_OPERATION', message: expect.stringMatching(/exceeds the 16 KiB mutation limit/i)});
        expect(workspaceManifest(dir)).toEqual(before);
      }
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1203] F4 mutation adapters return declared success/error envelopes and reject oversized ingress before writes', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
        expectDeclaredMutationPayload(tools, name, await client.callTool({name, arguments: args}));

      const created = await call('clad_create_feature', {
        slug: 'wire-create', title: 'Wire create', acceptance_criteria: [{ears: 'ubiquitous', text: 'The system shall expose the create envelope.'}],
      });
      expect(created.ok).toBe(true);
      const createError = await call('clad_create_feature', {
        slug: 'wire-create-error', design_impact: {classification: 'additive', rationale: 'A legacy request cannot define a new typed scenario.', capability: 'wire-cap', scenario: 'new-scenario', scenario_definition: {id: 'S-aaaaaaaa', slug: 'new-scenario', title: 'New', actor: 'Operator', goal: 'Create', success: 'Created', steps: ['Create'], feature_refs: []}},
      });
      expect(createError.ok).toBe(false);

      const designArtifact = 'docs/design/spec-0.2/proof-and-editing.md';
      mkdirSync(join(dir, 'docs', 'design', 'spec-0.2'), {recursive: true});
      writeFileSync(join(dir, designArtifact), '# proposed\n');
      const structural = await call('clad_create_feature', {
        slug: 'wire-structural', design_impact: {classification: 'structural', rationale: 'The output schema carries a reviewed decision.', artifacts: [designArtifact]},
      });
      writeFileSync(join(dir, designArtifact), '# reviewed\n');
      expect((await call('clad_resolve_design_impact', {feature: structural.id})).ok).toBe(true);
      expect((await call('clad_resolve_design_impact', {feature: 'F-ffffffff'})).ok).toBe(false);

      const featureNames = readdirSync(join(dir, 'spec', 'features')).sort();
      for (const [index, artifact] of ['docs/project-context.md', 'spec/architecture.yaml', 'spec/capabilities.yaml'].entries()) {
        const rejected = await client.callTool({
          name: 'clad_create_feature',
          arguments: {
            slug: `rejected-structural-${index}`,
            design_impact: {classification: 'structural', rationale: 'Only reviewed design documents can enter a structural review.', artifacts: [artifact]},
          },
        });
        expect(rejected.isError).toBe(true);
      }
      expect(readdirSync(join(dir, 'spec', 'features')).sort()).toEqual(featureNames);

      const oracleSource = await call('clad_create_feature', {
        slug: 'wire-oracle', acceptance_criteria: [{ears: 'ubiquitous', text: 'The system shall expose oracle evidence.'}],
      });
      const oracleShard = readFileSync(String(oracleSource.path), 'utf8');
      const oracleAc = /id:\s*(AC-[0-9a-f]+)/.exec(oracleShard)![1];
      expect((await call('clad_author_oracle', {featureId: oracleSource.id, acId: oracleAc, body: 'import {test} from "vitest"; test("wire", () => {});', readManifest: ['spec brief']})).ok).toBe(true);
      expect((await call('clad_author_oracle', {featureId: 'F-ffffffff', acId: 'AC-aaaaaaaa', body: 'export {};', readManifest: []})).ok).toBe(false);

      expect((await call('clad_create_scenario', {slug: 'wire-scenario', title: 'Wire scenario', flow: 'The user completes the journey.', features: ['F-001']})).ok).toBe(true);
      expect((await call('clad_link_capability', {capability: 'wire-capability', feature: 'F-001', title: 'Wire capability', summary: 'Expose the capability result.'})).ok).toBe(true);

      const schema02 = mkdtempSync(join(tmpdir(), 'clad-serve-wire-02-'));
      try {
        mkdirSync(join(schema02, 'spec', 'features'), {recursive: true});
        writeFileSync(join(schema02, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: wire\n  language: typescript\n  purpose: Keep adapter errors typed.\n  assurance_level: L2\n  scenario_policy: advisory\n');
        writeFileSync(join(schema02, 'spec', 'features', 'wire-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: Wire\nstatus: planned\npurpose: Keep adapter errors typed.\nmodules: []\ndepends_on: []\ncapability_refs: [governance]\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall preserve typed adapter errors.\n');
        writeFileSync(join(schema02, 'spec', 'capabilities.yaml'), 'capabilities:\n  - id: governance\n    title: Governance\n    outcome: Keep adapter errors typed.\n');
        writeFileSync(join(schema02, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
        const schema02Pair = await makePair(schema02);
        try {
          const schema02Tools = (await schema02Pair.client.listTools()).tools;
          const call02 = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
            expectDeclaredMutationPayload(schema02Tools, name, await schema02Pair.client.callTool({name, arguments: args}));
          expect((await call02('clad_create_scenario', {slug: 'missing-contract', features: ['F-aaaaaaaa']})).ok).toBe(false);
          expect((await call02('clad_link_capability', {capability: 'schema-link', feature: 'F-bbbbbbbb', title: 'Schema link', summary: 'Must find the feature.'})).ok).toBe(false);
        } finally {
          await schema02Pair.cleanup();
        }
      } finally {
        rmSync(schema02, {recursive: true, force: true});
      }

      const oversized: readonly [string, Record<string, unknown>][] = [
        ['clad_create_feature', {slug: 'oversize-create', title: 'x'.repeat(17 * 1024)}],
        ['clad_resolve_design_impact', {feature: `F-${'x'.repeat(17 * 1024)}`}],
        ['clad_author_oracle', {featureId: 'F-001', acId: 'AC-001', body: 'x'.repeat(17 * 1024), readManifest: []}],
        ['clad_create_scenario', {slug: 'oversize-scenario', title: 'x'.repeat(17 * 1024)}],
        ['clad_link_capability', {capability: 'oversize-capability', feature: 'F-001', title: 'x'.repeat(17 * 1024)}],
      ];
      for (const [name, args] of oversized) {
        const before = workspaceManifest(dir);
        const payload = await call(name, args);
        expect(payload).toMatchObject({ok: false, code: 'INVALID_OPERATION'});
        expect(workspaceManifest(dir)).toEqual(before);
      }
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-073/AC-208] listResources surfaces every declared resource URI through the MCP client', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {resources} = await client.listResources();
      const uris = resources.map((r) => r.uri).sort();
      expect(uris).toEqual([RESOURCE_URIS.audit, RESOURCE_URIS.events, RESOURCE_URIS.spec].sort());
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-073/AC-209] listPrompts surfaces every persona id plus the 0.6.0 alias prompts', async () => {
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

  test('[covers:F-0f4dd6/AC-017] a project without spec.yaml exposes only the initialization bootstrap and rejects mutations without writes', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'clad-serve-bare-'));
    const {client, cleanup} = await makePair(bare);
    try {
      const {tools} = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'clad_init',
        'clad_prepare_init',
        'clad_stage_init',
      ]);

      const res = await client.readResource({uri: RESOURCE_URIS.spec});
      const text = (res.contents as Array<{text: string}>)[0].text;
      expect(JSON.parse(text).error).toContain('spec not loaded');

      const mutation = await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'must-not-exist',
          design_impact: {classification: 'none', rationale: 'boundary probe'},
        },
      });
      expect(mutation.isError).toBe(true);
      expect((mutation.content as Array<{text: string}>)[0].text).toMatch(/not found/i);
      expect(existsSync(join(bare, 'spec'))).toBe(false);
    } finally {
      await cleanup();
      rmSync(bare, {recursive: true, force: true});
    }
  });

  test('[covers:F-c6a32fff/AC-6704a592] a missing spec keeps writes absent and returns both initialization and normal-search recovery hints', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'clad-serve-bare-recovery-'));
    const graphDir = mkdtempSync(join(tmpdir(), 'clad-serve-graph-recovery-'));
    writeFileSync(join(graphDir, 'spec.yaml'), IMPACT_SPEC);
    const barePair = await makePair(bare);
    const graphPair = await makePair(graphDir);
    try {
      const resource = await barePair.client.readResource({uri: RESOURCE_URIS.spec});
      const missingSpec = JSON.parse((resource.contents as Array<{text: string}>)[0].text) as {error: string};
      expect(missingSpec.error).toContain('clad init');

      const mutation = await barePair.client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'must-not-exist',
          design_impact: {classification: 'none', rationale: 'recovery boundary probe'},
        },
      });
      expect(mutation.isError).toBe(true);
      expect(existsSync(join(bare, 'spec'))).toBe(false);

      const miss = await graphPair.client.callTool({name: 'clad_get_graph', arguments: {query: 'not-present'}});
      expect(miss.isError).toBe(true);
      const missingGraph = JSON.parse((miss.content as Array<{text: string}>)[0].text) as {discovery: string};
      expect(missingGraph.discovery).toContain('normal code search');
    } finally {
      await barePair.cleanup();
      await graphPair.cleanup();
      rmSync(bare, {recursive: true, force: true});
      rmSync(graphDir, {recursive: true, force: true});
    }
  });

  test('[covers:F-5283985e/AC-4a71e2] doctor surfaces advertise read-only MCP annotations', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      for (const name of ['clad_list_features', 'clad_get_feature', 'clad_run_check']) {
        const tool = tools.find((candidate) => candidate.name === name);
        expect(tool?.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
        });
      }
      expect(tools.find((tool) => tool.name === 'clad_init')?.annotations?.readOnlyHint).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-24062d/AC-003] clad_list_features applies a case-insensitive slugSubstring filter (F-085, v0.3.10)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_list_features',
        arguments: {slugSubstring: 'AUTH'},
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

  test('[covers:F-24062d/AC-003] clad_list_features sort=recent orders backing feature files newest first (F-085, v0.3.10)', async () => {
    const featuresDir = join(dir, 'spec', 'features');
    mkdirSync(featuresDir, {recursive: true});
    const alpha = join(featuresDir, 'alpha-feature-001.yaml');
    const beta = join(featuresDir, 'beta-auth-flow-002.yaml');
    writeFileSync(alpha, 'id: F-001\n');
    writeFileSync(beta, 'id: F-002\n');
    utimesSync(alpha, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    utimesSync(beta, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_list_features',
        arguments: {sort: 'recent'},
      });
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.total).toBe(2);
      expect(parsed.features.map((feature: {id: string}) => feature.id)).toEqual(['F-002', 'F-001']);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-24062d/AC-004] clad_get_feature accepts slug lookup (F-085, v0.3.10)', async () => {
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

  test('[covers:F-24062d/AC-004] clad_get_feature returns a single feature when found by id', async () => {
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

  test('[covers:F-073/AC-210] clad_get_feature reports an unknown id as a tool error', async () => {
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

  test('[covers:F-dd8dc994/AC-1b03c358] MCP finding projections retain the detector raw schema', async () => {
    const specWithMissingCompletedModule = MINIMAL_SPEC
      .replace('status: planned', 'status: done')
      .replace('modules: []', 'modules: [src/nonexistent.ts]');
    writeFileSync(join(dir, 'spec.yaml'), specWithMissingCompletedModule, 'utf8');
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({name: 'clad_run_check', arguments: {verbose: true}});
      const report = JSON.parse((result.content as Array<{type: string; text: string}>)[0].text) as {
        findings: Array<{detector: string; severity: string; path?: string; message: string}>;
      };
      const raw = report.findings.find((finding) => finding.detector === 'MISSING_IMPLEMENTATION');
      expect(raw).toEqual({
        detector: 'MISSING_IMPLEMENTATION',
        severity: 'error',
        path: 'src/nonexistent.ts',
        message: "feature F-001 declares module 'src/nonexistent.ts' but the file does not exist",
      });
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
      expect(parsed).toMatchObject({ok: true, code: 'OK', message: expect.stringMatching(/no event history/i), byte_limit: 16 * 1024});
      expect(result.structuredContent).toEqual(parsed);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-67e33f/AC-002] clad_create_feature creates a new sharded feature file through the MCP surface', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'new-login-flow', title: 'New login flow', status: 'planned', design_impact: NO_DESIGN_IMPACT},
      });
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.slug).toBe('new-login-flow');
      expect(parsed.id).toMatch(/^F-[a-f0-9]{8}$/);
      // v0.3.10: filename is `<slug>-<hash8>.yaml` so the hash entropy
      // distinguishes concurrent invocations.
      expect(parsed.path).toMatch(/spec\/features\/new-login-flow-[a-f0-9]{8}\.yaml$/);
      expect(result.isError).not.toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-836a90/AC-002] clad_create_feature keeps the established create-only request compatible and only returns a capability-link hint', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'compatible-create', title: 'Compatible create', status: 'planned'},
      });
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content as Array<{type: string; text: string}>)[0].text) as {
        path: string;
        hint?: string;
        designImpact?: unknown;
      };
      expect(payload.hint).toContain('clad_link_capability');
      expect(payload.designImpact).toBeUndefined();
      expect(readFileSync(payload.path, 'utf8')).not.toContain('design_impact:');
    } finally {
      await cleanup();
    }
  });

  test('feature creation accepts only registered Tier-B docs/design artifacts and gates structural design until review', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
      writeFileSync(
        join(dir, 'spec', 'scenarios', 'reporting-flow-a1b2c3.yaml'),
        'id: S-a1b2c3\nslug: reporting-flow\ntitle: Reporting flow\nfeatures: []\n',
      );
      const additive = await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'payment-export',
          design_impact: {
            classification: 'additive',
            rationale: 'Extends the existing reporting surface.',
            capability: 'reporting',
            capability_title: 'Reporting',
            scenario: 'reporting-flow',
          },
        },
      });
      const additivePayload = JSON.parse((additive.content as Array<{type: string; text: string}>)[0].text);
      expect(additivePayload.designImpact.status).toBe('resolved');
      expect(readFileSync(join(dir, 'spec', 'capabilities.yaml'), 'utf8')).toContain(additivePayload.id);
      expect(readFileSync(join(dir, 'spec', 'scenarios', 'reporting-flow-a1b2c3.yaml'), 'utf8')).toContain(additivePayload.id);

      const designArtifact = 'docs/design/spec-0.2/proof-and-editing.md';
      mkdirSync(join(dir, 'docs', 'design', 'spec-0.2'), {recursive: true});
      writeFileSync(join(dir, designArtifact), '# Proposed service boundary\n');
      const structural = await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'payment-service-boundary',
          design_impact: {
            classification: 'structural',
            rationale: 'Introduces a separately deployed payment service.',
            artifacts: [designArtifact],
          },
        },
      });
      const structuralPayload = JSON.parse((structural.content as Array<{type: string; text: string}>)[0].text);
      expect(structuralPayload.designImpact.status).toBe('review_required');
      expect(readFileSync(structuralPayload.path, 'utf8')).toContain('status: review_required');

      const premature = await client.callTool({
        name: 'clad_resolve_design_impact',
        arguments: {feature: structuralPayload.id},
      });
      expect(premature.isError).toBe(true);

      writeFileSync(join(dir, designArtifact), '# Approved service boundary\n');

      const resolved = await client.callTool({
        name: 'clad_resolve_design_impact',
        arguments: {feature: structuralPayload.id},
      });
      expect(resolved.isError).not.toBe(true);
      expect(readFileSync(structuralPayload.path, 'utf8')).toContain('status: resolved');
    } finally {
      await cleanup();
    }
  });

  test('feature creation rolls back every write when an additive design link fails', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const capabilitiesPath = join(dir, 'spec', 'capabilities.yaml');
      const beforeCapabilities = existsSync(capabilitiesPath)
        ? readFileSync(capabilitiesPath, 'utf8')
        : null;
      const featuresPath = join(dir, 'spec', 'features');
      const beforeFeatures = existsSync(featuresPath) ? readdirSync(featuresPath).sort() : null;
      const result = await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'atomic-additive-feature',
          design_impact: {
            classification: 'additive',
            rationale: 'Must connect to the declared journey atomically.',
            capability: 'atomic-capability',
            scenario: 'missing-scenario',
          },
        },
      });
      expect(result.isError).toBe(true);
      expect(existsSync(featuresPath) ? readdirSync(featuresPath).sort() : null).toEqual(beforeFeatures);
      expect(existsSync(capabilitiesPath) ? readFileSync(capabilitiesPath, 'utf8') : null).toBe(beforeCapabilities);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1203] schema 0.1 additive create rejects a schema 0.2 scenario definition without writing a partial feature', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const before = existsSync(join(dir, 'spec', 'features')) ? readdirSync(join(dir, 'spec', 'features')).sort() : [];
      const result = await client.callTool({
        name: 'clad_create_feature',
        arguments: {
          slug: 'legacy-definition-rejected',
          design_impact: {
            classification: 'additive', rationale: 'The legacy path can only link a pre-existing journey.', capability: 'reporting',
            scenario: 'new-journey',
            scenario_definition: {id: 'S-aaaaaaaa', slug: 'new-journey', title: 'New journey', actor: 'Operator', goal: 'Create', success: 'Created', steps: ['Create'], feature_refs: []},
          },
        },
      });
      expect(result.isError).toBe(true);
      expect((result.content as Array<{type: string; text: string}>)[0]?.text).toContain('only by schema 0.2');
      expect(existsSync(join(dir, 'spec', 'features')) ? readdirSync(join(dir, 'spec', 'features')).sort() : []).toEqual(before);
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
          design_impact: NO_DESIGN_IMPACT,
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
        arguments: {slug: 'widget', title: 'Widget', status: 'done', design_impact: NO_DESIGN_IMPACT, acceptance_criteria: [{text: 'does the thing'}]},
      });
      const createdParsed = JSON.parse((created.content as Array<{type: string; text: string}>)[0].text);
      const featureId = createdParsed.id as string;
      const shardPath = createdParsed.path as string; // createFeature returns an absolute path
      // AC ids are auto-assigned (AC-<hash8> or legacy AC-NNN) — read the real one back.
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

  test('[covers:F-d7312b/AC-002] clad_create_scenario creates a new sharded scenario file (F-087, v0.3.12)', async () => {
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
      expect(result.structuredContent).toEqual(parsed);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1203] event tool and resource fail closed on an outside symlink without returning its content', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'clad-events-outside-'));
    try {
      const sentinel = join(outside, 'events.jsonl');
      writeFileSync(sentinel, `${JSON.stringify({type: 'gate_run', secret: 'OUTSIDE_EVENT_SECRET'})}\n`);
      symlinkSync(sentinel, join(dir, '.cladding', 'events.log.jsonl'));
      const before = readFileSync(sentinel, 'utf8');
      const entries = readdirSync(outside).sort();
      const {client, cleanup} = await makePair(dir);
      try {
        const tool = await client.callTool({name: 'clad_get_events', arguments: {limit: 5}});
        const resource = await client.readResource({uri: RESOURCE_URIS.events});
        const toolText = (tool.content as Array<{text: string}>)[0].text;
        const resourceText = (resource.contents[0] as {text: string}).text;
        expect(JSON.parse(toolText).events).toEqual([]);
        expect(JSON.parse(resourceText).events).toEqual([]);
        expect(toolText).not.toContain('OUTSIDE_EVENT_SECRET');
        expect(resourceText).not.toContain('OUTSIDE_EVENT_SECRET');
      } finally {
        await cleanup();
      }
      expect(readFileSync(sentinel, 'utf8')).toBe(before);
      expect(readdirSync(outside).sort()).toEqual(entries);
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
  });

  test('clad_get_events omits a single oversized event instead of exceeding its response ceiling', async () => {
    writeFileSync(
      join(dir, '.cladding', 'events.log.jsonl'),
      `${JSON.stringify({type: 'gate_run', payload: 'x'.repeat(70 * 1024)})}\n`,
    );
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({name: 'clad_get_events', arguments: {limit: 1}});
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16 * 1024);
      expect(parsed.events).toEqual([]);
      expect(parsed.oversized_events).toBe(1);
      expect(parsed.omitted_events).toBe(1);
      expect(result.structuredContent).toEqual(parsed);
    } finally {
      await cleanup();
    }
  });

  test('shares the recovered bounded event projection with cladding://events and caps final envelopes', async () => {
    writeFileSync(
      join(dir, '.cladding', 'events.log.jsonl'),
      Array.from({length: 80}, (_, index) => JSON.stringify({type: 'gate_run', id: index, payload: 'x'.repeat(2048)})).join('\n') + '\n',
    );
    const {client, cleanup} = await makePair(dir);
    try {
      const tool = await client.callTool({name: 'clad_get_events', arguments: {limit: 50}});
      const resource = await client.readResource({uri: RESOURCE_URIS.events});
      const toolPayload = JSON.parse((tool.content as Array<{text: string}>)[0].text);
      const resourcePayload = JSON.parse((resource.contents[0] as {text: string}).text);
      expect(resourcePayload).toEqual(toolPayload);
      expect(Buffer.byteLength(JSON.stringify(tool))).toBeLessThanOrEqual(16 * 1024);
      expect(Buffer.byteLength(JSON.stringify(resource))).toBeLessThanOrEqual(16 * 1024);
    } finally {
      await cleanup();
    }
  });

  test('clad_get_events accounts for metadata while bounding a 500-event response', async () => {
    writeFileSync(
      join(dir, '.cladding', 'events.log.jsonl'),
      Array.from({length: 500}, (_, index) => JSON.stringify({type: 'gate_run', id: index, payload: 'x'.repeat(256)})).join('\n') + '\n',
    );
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({name: 'clad_get_events', arguments: {limit: 500}});
      const text = (result.content as Array<{type: string; text: string}>)[0].text;
      const parsed = JSON.parse(text);
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16 * 1024);
      expect(parsed.events.length).toBeLessThan(500);
      expect(parsed.omitted_events).toBeGreaterThan(0);
      expect(result.structuredContent).toEqual(parsed);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-4f4a12c3/AC-4f4a1203] clad_get_events returns the declared error payload with text and structured parity', async () => {
    writeFileSync(join(dir, '.cladding', 'spec-transaction.json'), '{torn');
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({name: 'clad_get_events', arguments: {}});
      const parsed = JSON.parse((result.content as Array<{type: string; text: string}>)[0].text);
      expect(result.isError).toBe(true);
      expect(parsed).toMatchObject({ok: false, code: 'RECOVERY_FAILED', message: expect.any(String), byte_limit: 16 * 1024});
      expect(result.structuredContent).toEqual(parsed);
      expect(Buffer.byteLength(JSON.stringify(parsed, null, 2))).toBeLessThanOrEqual(16 * 1024);
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

  test('[covers:F-570a3f/AC-86dd41][covers:F-570a3f/AC-a8ee9c] clad_create_feature result carries schema_version and a gate field (JSON, not appended text)', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const res = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'gate-footer-probe', design_impact: NO_DESIGN_IMPACT, acceptance_criteria: [{ears: 'ubiquitous', text: 'probe'}]},
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

  test('[covers:F-570a3f/AC-86dd41][covers:F-570a3f/AC-4cba6e] clad_run_gate runs the real pipeline and returns the untruncated JSON outcome', async () => {
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
  test('[covers:F-551a1c/AC-0e9245] recording an oracle for an AC no policy requires carries voluntary:true + a cost note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-serve-vol-'));
    writeFileSync(join(dir, 'spec.yaml'), MINIMAL_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const {client, cleanup} = await makePair(dir);
    try {
      const created = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'vol-probe', status: 'done', design_impact: NO_DESIGN_IMPACT, acceptance_criteria: [{ears: 'ubiquitous', text: 'probe', test_refs: ['spec.yaml']}]},
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
  test('[covers:F-06dfdad6/AC-c2cef0] preserves clad_get_context schema_version while the graph tool names skill nodes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-serve-working-set-contract-'));
    writeFileSync(join(dir, 'spec.yaml'), MINIMAL_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      const context = tools.find((tool) => tool.name === 'clad_get_context');
      const workingSet = tools.find((tool) => tool.name === 'clad_get_working_set');
      const graph = tools.find((tool) => tool.name === 'clad_get_graph');
      expect(context).toBeDefined();
      expect(workingSet).toBeDefined();
      expect(graph).toBeDefined();
      expect(String(workingSet?.description)).toContain('token-budgeted working set');
      expect(String(graph?.description)).toContain('skill nodes');

      const result = await client.callTool({name: 'clad_get_context', arguments: {query: 'F-001'}});
      expect(result.isError).toBeFalsy();
      const payload = JSON.parse((result.content as Array<{type: string; text: string}>)[0].text) as {
        schema_version: number;
        focus: {id: string};
      };
      expect(payload.schema_version).toBe(1);
      expect(payload.focus.id).toBe('F-001');
    } finally {
      await cleanup();
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('[covers:F-d2c806/AC-0fe45d][covers:F-d2c806/AC-10ea8a] returns the slice with schema_version; a miss is isError with the accepted forms', async () => {
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
  test('no-query answers a stats SUMMARY (token-budget discipline), focus answers a subgraph, miss is isError', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-serve-graph-'));
    writeFileSync(join(dir, 'spec.yaml'), IMPACT_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('clad_get_graph');

      // v0.7.1: the no-query form used to dump the WHOLE graph (~70k tokens on a
      // mid-size project) into one MCP result — now it is a compact summary.
      const all = await client.callTool({name: 'clad_get_graph', arguments: {}});
      expect(all.isError).toBeFalsy();
      const summaryText = (all.content as Array<{type: string; text: string}>)[0].text;
      const summary = JSON.parse(summaryText) as {
        schema_version: number;
        summary: boolean;
        stats: {nodeCount: number; edgeCount: number; hubs: Array<{id: string}>};
        hint: string;
      };
      expect(summary.schema_version).toBe(1);
      expect(summary.summary).toBe(true);
      expect(summary.stats.nodeCount).toBeGreaterThan(0);
      expect(summary.stats.hubs.length).toBeGreaterThan(0);
      expect(summary.hint).toContain('clad graph export');
      expect(summaryText).not.toContain('"from"'); // no raw edge dump rides the summary

      const focused = await client.callTool({name: 'clad_get_graph', arguments: {query: 'F-001', max_depth: 1}});
      expect(focused.isError).toBeFalsy();
      const sub = JSON.parse((focused.content as Array<{type: string; text: string}>)[0].text) as {
        nodes: Array<{id: string}>;
        edges: unknown[];
      };
      expect(sub.nodes.some((n) => n.id === 'feature:F-001')).toBe(true);
      expect(sub.edges.length).toBeGreaterThan(0);

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

// ─── F4 — explicit create keeps its derived projections in the same transaction ───
//
// The older server path committed a feature and later attempted inventory/index
// refresh. F4 makes the projections part of the explicit create transaction;
// a merge marker cannot create a partial authoritative feature state.
describe('MCP create derived-projection transaction (F4)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-serve-gitop-'));
    writeFileSync(join(dir, 'spec.yaml'), MINIMAL_SPEC);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    execFileSync('git', ['init', '-q'], {cwd: dir});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('a git op in progress: the explicit create still commits its inventory + index with the shard', async () => {
    writeFileSync(join(dir, '.git', 'MERGE_HEAD'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');
    const {client, cleanup} = await makePair(dir);
    try {
      const res = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'mid-merge-feature', title: 'Mid merge', status: 'planned', design_impact: NO_DESIGN_IMPACT},
      });
      expect(res.isError).not.toBe(true);
      const parsed = JSON.parse((res.content as Array<{type: string; text: string}>)[0].text);
      const shardPath = join(dir, 'spec', 'features', `${parsed.slug}-${parsed.id.slice(2)}.yaml`);
      expect(existsSync(shardPath)).toBe(true); // shard landed on disk

      expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('inventory:');
      expect(existsSync(join(dir, 'spec', 'index.yaml'))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('with no git op the same create remains an atomic feature + projection write', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const res = await client.callTool({
        name: 'clad_create_feature',
        arguments: {slug: 'settled-feature', title: 'Settled', status: 'planned', design_impact: NO_DESIGN_IMPACT},
      });
      expect(res.isError).not.toBe(true);
      expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('inventory:');
      expect(existsSync(join(dir, 'spec', 'index.yaml'))).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

describe('clad_get_working_set (F-06dfdad6)', () => {
  test('registers clad_get_working_set without touching clad_get_context', () => {
    expect(TOOL_NAMES).toContain('clad_get_working_set');
    expect(TOOL_NAMES).toContain('clad_get_context'); // the existing context tool stays registered + frozen
  });

  test('clad_get_working_set round-trips real module CODE, echoes the budget, and misses as isError', async () => {
    // The only prior test asserted a hand-maintained constant against itself
    // (vacuous — the handler was never invoked). This drives the real MCP path
    // the way clad_get_impact's test does.
    const dir = mkdtempSync(join(tmpdir(), 'clad-serve-ws-'));
    writeFileSync(join(dir, 'spec.yaml'), IMPACT_SPEC);
    mkdirSync(join(dir, 'src'), {recursive: true});
    writeFileSync(join(dir, 'src', 'core.ts'), 'export const CORE_MARKER = 42;\n', 'utf8');
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const {client, cleanup} = await makePair(dir);
    try {
      const ok = await client.callTool({name: 'clad_get_working_set', arguments: {query: 'F-001', max_tokens: 5000}});
      expect(ok.isError).toBeFalsy();
      const ws = JSON.parse((ok.content as Array<{type: string; text: string}>)[0].text) as {
        schema_version: number;
        must_edit: {id: string; code: Array<{path: string; text?: string}>};
        breaks_if_changed: {impacted: Array<{id: string}>; regression_tests: string[]};
        budget: {max_tokens: number; used_tokens: number};
      };
      expect(ws.schema_version).toBe(1);
      expect(ws.must_edit.id).toBe('F-001');
      expect(ws.must_edit.code.some((c) => c.path === 'src/core.ts' && c.text?.includes('CORE_MARKER'))).toBe(true);
      expect(ws.breaks_if_changed.impacted.map((f) => f.id)).toContain('F-002');
      expect(ws.budget.max_tokens).toBe(5000); // the argument reaches buildWorkingSet
      expect(ws.budget.used_tokens).toBeGreaterThan(0);

      const miss = await client.callTool({name: 'clad_get_working_set', arguments: {query: 'nope'}});
      expect(miss.isError).toBe(true);
      const parsed = JSON.parse((miss.content as Array<{type: string; text: string}>)[0].text) as {not_found: string};
      expect(parsed.not_found).toBe('nope');
    } finally {
      await cleanup();
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
