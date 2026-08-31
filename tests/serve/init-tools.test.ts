// Cladding · natural-language init MCP boundary (F-0f4dd6).

import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {parse as parseYaml} from 'yaml';
import {refineOnboarding, resolveOnboardingReview} from '../../src/cli/clarify.js';
import {prepareHostClarify, prepareHostInit, renderHostDraft} from '../../src/cli/host-onboarding.js';
import {runInit} from '../../src/cli/init.js';
import {captureArtifactDigests, loadState, saveState} from '../../src/cli/scan/onboarding-state.js';
import {buildServer, TOOL_NAMES} from '../../src/serve/server.js';

interface Pair {
  readonly client: Client;
  readonly cleanup: () => Promise<void>;
}

async function makePair(cwd: string, initialize: typeof runInit = runInit): Promise<Pair> {
  const server = buildServer({
    cwd,
    name: 'cladding-init-test',
    version: '0.0.0-test',
    onboarding: {
      renderDraft: (value) => renderHostDraft(value as Parameters<typeof renderHostDraft>[0]),
      prepareInit: ({cwd: root, mode, intent}) => prepareHostInit(root, mode, intent),
      initialize,
      prepareClarify: (answer, {cwd: root}) => prepareHostClarify(root, answer),
      clarify: refineOnboarding,
      resolveReview: (targets, {cwd: root}) => resolveOnboardingReview(targets, {cwd: root}),
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({name: 'cladding-init-client', version: '0.0.0-test'});
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

function payload(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const text = (result.content as Array<{type: string; text: string}>)[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

const draft = {
  mode: 'greenfield',
  project_context: {why: 'Enable reliable B2B payments.', problem: 'Payment operations are fragmented.', purpose: 'Give operators one safe workflow.'},
  capabilities: [
    {id: 'payments', title: 'Payments', summary: 'Process payments safely.', surface: 'feature'},
    {id: 'audit', title: 'Audit', summary: 'Trace operator actions.', surface: 'platform'},
    {id: 'webhooks', title: 'Webhooks', summary: 'Deliver signed events.', surface: 'infrastructure'},
  ],
  architecture: {layers: [{name: 'core', forbidden_imports: ['adapters']}]},
  scenarios: [{slug: 'payment-flow', title: 'Payment flow', flow: 'An operator requests and confirms a payment.'}],
  questions: ['Which market launches first?'],
} as const;
async function prepare(client: Client, arguments_: Record<string, unknown>): Promise<{token: string; confirmation: string}> {
  const result = await client.callTool({name: 'clad_prepare_init', arguments: arguments_});
  const prepared = payload(result);
  return {token: prepared.token as string, confirmation: prepared.approvalChallenge as string};
}

describe('serve/server — natural-language init tools', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-mcp-init-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-0f4dd6/AC-002] idea mode asks for intent before writing any project artifact', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {tools} = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'clad_init',
        'clad_prepare_init',
        'clad_stage_init',
      ]);
      const result = await client.callTool({name: 'clad_prepare_init', arguments: {mode: 'idea'}});
      expect(payload(result)).toMatchObject({status: 'needs_input', changed: false});
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-019] idea mode initializes through the shared engine and writes only AGENTS.md after spec', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {token, confirmation} = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      const result = await client.callTool({name: 'clad_init', arguments: {token, confirmation, draft}});
      expect(result.isError).not.toBe(true);
      expect(payload(result)).toMatchObject({
        status: 'needs_answers',
        changed: true,
        onboardingSource: 'host',
      });
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(true);
      expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('onboarding_seeded: true');
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
      const {tools} = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-016] approval envelope survives an MCP server restart without prepare writing files', async () => {
    const first = await makePair(dir);
    const prepared = await prepare(first.client, {mode: 'idea', intent: 'B2B payment SaaS'});
    await first.cleanup();
    expect(readdirSync(dir)).toEqual([]);

    const second = await makePair(dir);
    try {
      const result = await second.client.callTool({name: 'clad_init', arguments: {
        token: prepared.token,
        confirmation: prepared.confirmation,
        draft,
      }});
      expect(result.isError).not.toBe(true);
      expect(payload(result)).toMatchObject({changed: true, onboardingSource: 'host'});
    } finally {
      await second.cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-020] process-per-turn hosts can apply the staged draft by exact challenge when they discard opaque tool tokens', async () => {
    const first = await makePair(dir);
    const prepared = await prepare(first.client, {mode: 'idea', intent: 'B2B payment SaaS'});
    const staged = await first.client.callTool({name: 'clad_stage_init', arguments: {
      token: prepared.token,
      draft,
    }});
    expect(payload(staged)).toMatchObject({
      status: 'staged',
      changed: false,
      approvalChallenge: prepared.confirmation,
    });
    await first.cleanup();
    expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(dir, '.cladding', 'host', 'onboarding-pending'))).toBe(true);

    const second = await makePair(dir);
    try {
      const result = await second.client.callTool({name: 'clad_init', arguments: {
        confirmation: prepared.confirmation,
      }});
      expect(result.isError).not.toBe(true);
      expect(payload(result)).toMatchObject({changed: true, onboardingSource: 'host'});
    } finally {
      await second.cleanup();
    }
  });

  test('a tampered staged draft is rejected as draft_required, never rendered', async () => {
    const first = await makePair(dir);
    const prepared = await prepare(first.client, {mode: 'idea', intent: 'B2B payment SaaS'});
    await first.client.callTool({name: 'clad_stage_init', arguments: {token: prepared.token, draft}});
    await first.cleanup();

    const cacheDir = join(dir, '.cladding', 'host', 'onboarding-pending');
    const [entry] = readdirSync(cacheDir);
    const cachePath = join(cacheDir, entry);
    const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as {draft: Record<string, unknown>};
    cached.draft.project_context = null; // the crash-shape a raw renderDraft would hit
    cached.draft.capabilities = 'garbage-not-an-array';
    writeFileSync(cachePath, JSON.stringify(cached));

    const second = await makePair(dir);
    try {
      const result = await second.client.callTool({name: 'clad_init', arguments: {
        confirmation: prepared.confirmation,
      }});
      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({status: 'draft_required', changed: false});
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
    } finally {
      await second.cleanup();
    }
  });

  test('staging sweeps expired consent-cache envelopes left by abandoned flows', async () => {
    const cacheDir = join(dir, '.cladding', 'host', 'onboarding-pending');
    mkdirSync(cacheDir, {recursive: true});
    const stale = join(cacheDir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef.json');
    writeFileSync(stale, JSON.stringify({expiresAt: Date.now() - 60_000, token: 'x', request: {}}));

    const {client, cleanup} = await makePair(dir);
    try {
      const prepared = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      await client.callTool({name: 'clad_stage_init', arguments: {token: prepared.token, draft}});
      expect(existsSync(stale)).toBe(false);
      expect(readdirSync(cacheDir).length).toBe(1); // only the live envelope remains
    } finally {
      await cleanup();
    }
  });

  test('approval without a direct or staged draft fails closed', async () => {
    const first = await makePair(dir);
    const prepared = await prepare(first.client, {mode: 'document', document_path: (() => {
      mkdirSync(join(dir, 'docs'), {recursive: true});
      writeFileSync(join(dir, 'docs', 'plan.md'), 'Complete payment product plan.');
      return 'docs/plan.md';
    })()});
    await first.cleanup();

    const second = await makePair(dir);
    try {
      const result = await second.client.callTool({name: 'clad_init', arguments: {
        confirmation: prepared.confirmation,
      }});
      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({status: 'draft_required', changed: false});
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
    } finally {
      await second.cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-009] initial request is not accepted as the separate write confirmation', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const intent = 'B2B payment SaaS';
      const preparation = await client.callTool({name: 'clad_prepare_init', arguments: {mode: 'idea', intent}});
      expect(payload(preparation)).toMatchObject({
        status: 'needs_confirmation',
        changed: false,
        requiresSeparateUserConfirmation: true,
      });
      const token = payload(preparation).token as string;
      const result = await client.callTool({name: 'clad_init', arguments: {token, confirmation: intent, draft}});
      expect(result.isError).toBe(true);
      expect((result.content as Array<{text: string}>)[0].text).toContain('Invalid arguments');
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-010] an arbitrary reply after preview is not accepted as approval', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {token} = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      const result = await client.callTool({name: 'clad_init', arguments: {
        token,
        confirmation: 'Which files will be created?',
        draft,
      }});
      expect(result.isError).toBe(true);
      expect((result.content as Array<{text: string}>)[0].text).toContain('Invalid arguments');
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test('a malformed host draft is rejected before any write', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {token, confirmation} = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      const result = await client.callTool({name: 'clad_init', arguments: {
        token,
        confirmation,
        draft: {...draft, capabilities: []},
      }});
      expect(result.isError).toBe(true);
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-014] a failed multi-file apply restores the pre-initialization workspace', async () => {
    writeFileSync(join(dir, '.gitignore'), 'user-entry\n');
    const failingInit = (async ({cwd}: {cwd?: string}) => {
      writeFileSync(join(cwd!, 'spec.yaml'), 'partial\n');
      writeFileSync(join(cwd!, '.gitignore'), 'clobbered\n');
      throw new Error('injected write failure');
    }) as typeof runInit;
    const {client, cleanup} = await makePair(dir, failingInit);
    try {
      const {token, confirmation} = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      const result = await client.callTool({name: 'clad_init', arguments: {token, confirmation, draft}});
      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({status: 'failed', changed: false});
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
      expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('user-entry\n');
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-001] tools-only MCP client drives init and clarify without sampling', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {token, confirmation} = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      const initialized = await client.callTool({name: 'clad_init', arguments: {token, confirmation, draft}});
      expect(payload(initialized)).toMatchObject({
        status: 'needs_answers',
        onboardingSource: 'host',
        nextQuestion: 'Which market launches first?',
      });

      const preparedClarify = await client.callTool({name: 'clad_prepare_clarify', arguments: {answer: 'Korea'}});
      const clarifyToken = payload(preparedClarify).token as string;
      const clarified = await client.callTool({name: 'clad_clarify', arguments: {
        answer: 'Korea', token: clarifyToken, draft: {...draft, questions: []},
      }});
      expect(payload(clarified)).toMatchObject({
        status: 'done',
        remainingQuestions: 0,
        refinementSource: 'host',
      });
    } finally {
      await cleanup();
    }
  });

  test('user-edited onboarding design requires review before accepted proposals complete onboarding', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {token, confirmation} = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      await client.callTool({name: 'clad_init', arguments: {token, confirmation, draft}});
      writeFileSync(join(dir, 'docs', 'project-context.md'), '# User-owned context\n');

      const prepared = await client.callTool({name: 'clad_prepare_clarify', arguments: {answer: 'Korea'} });
      const clarifyToken = payload(prepared).token as string;
      const clarified = await client.callTool({name: 'clad_clarify', arguments: {
        answer: 'Korea', token: clarifyToken, draft: {...draft, questions: []},
      }});
      const review = payload(clarified);
      expect(review.status).toBe('needs_review');
      expect(readFileSync(join(dir, 'docs', 'project-context.md'), 'utf8')).toBe('# User-owned context\n');
      expect(review.pendingReview).toContain('docs/project-context.md');

      const resolved = await client.callTool({name: 'clad_resolve_onboarding_review', arguments: {
        targets: review.pendingReview,
      }});
      expect(payload(resolved)).toMatchObject({status: 'done', changed: true, remaining: []});
      expect(readFileSync(join(dir, 'docs', 'project-context.md'), 'utf8')).toContain('Enable reliable B2B payments.');
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-003][covers:F-0f4dd6/AC-012] document mode loads the full project-local planning document and combines it with observed source', async () => {
    mkdirSync(join(dir, 'docs'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const existing = true;\n');
    const plan = Array.from({length: 40}, (_, i) => `Section ${i}: payment requirement`).join('\n');
    writeFileSync(join(dir, 'docs', 'plan.md'), plan);
    const {client, cleanup} = await makePair(dir);
    try {
      const preparation = await client.callTool({name: 'clad_prepare_init', arguments: {mode: 'document', document_path: 'docs/plan.md'}});
      const preparedPayload = payload(preparation);
      expect(preparedPayload.prompt).toContain(plan);
      const token = preparedPayload.token as string;
      const confirmation = preparedPayload.approvalChallenge as string;
      const result = await client.callTool({name: 'clad_init', arguments: {token, confirmation, draft}});
      expect(result.isError).not.toBe(true);
      expect(readFileSync(join(dir, 'docs', 'project-context.md'), 'utf8')).toContain('Enable reliable B2B payments.');
      expect(readFileSync(join(dir, 'docs', 'conventions.md'), 'utf8')).toContain('derived from observed code');
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-003] document mode rejects a path that escapes the connected project', async () => {
    const outside = join(dirname(dir), 'outside-plan.md');
    writeFileSync(outside, 'outside');
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_prepare_init',
        arguments: {mode: 'document', document_path: '../outside-plan.md', no_llm: true},
      });
      expect(result.isError).toBe(true);
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
    } finally {
      await cleanup();
      rmSync(outside, {force: true});
    }
  });

  test('[covers:F-0f4dd6/AC-003] document mode rejects malformed UTF-8 before preparing or writing', async () => {
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'plan.md'), Buffer.from([0xc3, 0x28]));
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({
        name: 'clad_prepare_init',
        arguments: {mode: 'document', document_path: 'docs/plan.md'},
      });
      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({status: 'invalid_request', changed: false});
      expect(payload(result).error).toMatch(/UTF-8/);
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-004][covers:F-70ed1afd/AC-039f62b6][covers:F-70ed1afd/AC-d20df076][covers:F-70ed1afd/AC-aa2d0e2c] existing mode preserves fired draft capabilities while forcing observed scanning for a sparse codebase', async () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const value = 1;\n');
    const {client, cleanup} = await makePair(dir);
    try {
      const {token, confirmation} = await prepare(client, {mode: 'existing'});
      const result = await client.callTool({name: 'clad_init', arguments: {token, confirmation, draft: {...draft, mode: 'existing-adoption'}}});
      expect(result.isError).not.toBe(true);
      const conventions = readFileSync(join(dir, 'docs', 'conventions.md'), 'utf8');
      expect(conventions).toContain('derived from observed code');
      expect(conventions).toContain('## Observed style');
      const architecture = readFileSync(join(dir, 'spec', 'architecture.yaml'), 'utf8');
      expect(architecture).toContain('layers: []');
      expect(architecture).not.toContain('name: core');
      // Regression: an existing-project adoption with no README `##` headings must still
      // persist the host draft's approved capabilities — not land `capabilities: []`.
      const capabilitiesBody = readFileSync(join(dir, 'spec', 'capabilities.yaml'), 'utf8');
      expect(capabilitiesBody).not.toContain('capabilities: []');
      const capabilities = (parseYaml(capabilitiesBody) as {capabilities?: Array<{id?: string; title?: string; summary?: string; surface?: string}>}).capabilities ?? [];
      expect(capabilities.length).toBeGreaterThanOrEqual(3);
      const capabilityIds = capabilities.map((capability) => capability.id);
      for (const id of ['payments', 'audit', 'webhooks']) {
        expect(capabilityIds).toContain(id);
      }
      expect(capabilities.find((capability) => capability.id === 'payments')).toMatchObject({
        id: 'payments',
        title: 'Payments',
        summary: 'Process payments safely.',
        surface: 'feature',
      });
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-005] an initialized project returns without changing files unless refresh is explicit', async () => {
    writeFileSync(join(dir, 'spec.yaml'), 'sentinel\n');
    const {client, cleanup} = await makePair(dir);
    try {
      const before = readFileSync(join(dir, 'spec.yaml'), 'utf8');
      const result = await client.callTool({name: 'clad_prepare_init', arguments: {mode: 'existing'}});
      expect(payload(result)).toEqual({status: 'already_initialized', changed: false});
      expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toBe(before);
      expect(readdirSync(dir)).toEqual(['spec.yaml']);
    } finally {
      await cleanup();
    }
  });

  test('stale and replayed apply tokens never write twice', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {token: staleToken, confirmation: staleConfirmation} = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      writeFileSync(join(dir, 'README.md'), '# changed after prepare\n');
      const stale = await client.callTool({name: 'clad_init', arguments: {token: staleToken, confirmation: staleConfirmation, draft}});
      expect(payload(stale)).toMatchObject({status: 'stale_preparation', changed: false});
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);

      const {token, confirmation} = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      const first = await client.callTool({name: 'clad_init', arguments: {token, confirmation, draft}});
      expect(payload(first)).toMatchObject({changed: true});
      const specBeforeReplay = readFileSync(join(dir, 'spec.yaml'), 'utf8');
      const replay = await client.callTool({name: 'clad_init', arguments: {token, confirmation, draft}});
      expect(payload(replay)).toMatchObject({status: 'stale_preparation', changed: false});
      expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toBe(specBeforeReplay);
    } finally {
      await cleanup();
    }
  });

  test('[covers:F-0f4dd6/AC-006] clarify returns the next pending question as structured output', async () => {
    saveState(dir, {
      intent: 'B2B payment SaaS',
      language: 'typescript',
      projectName: 'demo',
      mode: 'greenfield',
      startedAt: '2026-07-14T00:00:00.000Z',
      status: 'active',
      qa: [
        {question: 'Who is the primary user?', answer: null},
        {question: 'Which market launches first?', answer: null},
      ],
    });
    mkdirSync(join(dir, 'docs'), {recursive: true});
    mkdirSync(join(dir, 'spec'), {recursive: true});
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: demo\n  language: typescript\nfeatures: []\n');
    writeFileSync(join(dir, 'docs', 'project-context.md'), '# Context\n');
    writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'schema: "0.1"\ncapabilities: []\n');
    writeFileSync(join(dir, 'spec', 'architecture.yaml'), 'version: "0.1"\nlayers: []\n');
    saveState(dir, {...loadState(dir)!, artifactDigests: captureArtifactDigests(dir)});

    const {client, cleanup} = await makePair(dir);
    try {
      const preparedClarify = await client.callTool({name: 'clad_prepare_clarify', arguments: {answer: 'Business operators'}});
      const token = payload(preparedClarify).token as string;
      const result = await client.callTool({name: 'clad_clarify', arguments: {
        answer: 'Business operators', token, draft: {...draft, questions: []},
      }});
      expect(result.isError).not.toBe(true);
      expect(payload(result)).toMatchObject({
        status: 'active',
        nextQuestion: 'Which market launches first?',
        remainingQuestions: 1,
      });
    } finally {
      await cleanup();
    }
  });

  test('clarify preparation becomes stale when another session advances onboarding state', async () => {
    saveState(dir, {
      intent: 'B2B payment SaaS',
      language: 'typescript',
      projectName: 'demo',
      mode: 'greenfield',
      startedAt: '2026-07-14T00:00:00.000Z',
      status: 'active',
      qa: [{question: 'Who is the primary user?', answer: null}],
    });
    mkdirSync(join(dir, 'docs'), {recursive: true});
    mkdirSync(join(dir, 'spec'), {recursive: true});
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: demo\n  language: typescript\nfeatures: []\n');
    writeFileSync(join(dir, 'docs', 'project-context.md'), '# Context\n');
    writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'schema: "0.1"\ncapabilities: []\n');
    writeFileSync(join(dir, 'spec', 'architecture.yaml'), 'version: "0.1"\nlayers: []\n');

    const {client, cleanup} = await makePair(dir);
    try {
      const preparation = await client.callTool({
        name: 'clad_prepare_clarify',
        arguments: {answer: 'Business operators'},
      });
      const token = payload(preparation).token as string;
      saveState(dir, {...loadState(dir)!, qa: [{question: 'Who is the primary user?', answer: 'Another answer'}]});
      const result = await client.callTool({name: 'clad_clarify', arguments: {
        answer: 'Business operators', token, draft: {...draft, questions: []},
      }});
      expect(payload(result)).toMatchObject({status: 'stale_preparation', changed: false});
    } finally {
      await cleanup();
    }
  });
});
