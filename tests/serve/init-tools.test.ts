// Cladding · natural-language init MCP boundary (F-0f4dd6).

import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {refineOnboarding, resolveOnboardingReview} from '../../src/cli/clarify.js';
import {prepareHostClarify, prepareHostInit, renderHostDraft} from '../../src/cli/host-onboarding.js';
import {runInit} from '../../src/cli/init.js';
import {captureArtifactDigests, loadState, saveState} from '../../src/cli/scan/onboarding-state.js';
import {buildServer} from '../../src/serve/server.js';

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

  test('idea mode asks for intent before writing any project artifact', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const result = await client.callTool({name: 'clad_prepare_init', arguments: {mode: 'idea'}});
      expect(payload(result)).toMatchObject({status: 'needs_input', changed: false});
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  test('idea mode initializes through the shared engine and writes host instructions after spec', async () => {
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
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test('approval envelope survives an MCP server restart without prepare writing files', async () => {
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

  test('process-per-turn hosts can apply by exact challenge when they discard opaque tool tokens', async () => {
    const first = await makePair(dir);
    const prepared = await prepare(first.client, {mode: 'idea', intent: 'B2B payment SaaS'});
    await first.cleanup();
    expect(readdirSync(dir)).toEqual([]);

    const second = await makePair(dir);
    try {
      const result = await second.client.callTool({name: 'clad_init', arguments: {
        confirmation: prepared.confirmation,
        draft,
      }});
      expect(result.isError).not.toBe(true);
      expect(payload(result)).toMatchObject({changed: true, onboardingSource: 'host'});
    } finally {
      await second.cleanup();
    }
  });

  test('initial request is not accepted as the separate write confirmation', async () => {
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
      expect(payload(result)).toMatchObject({status: 'confirmation_required', changed: false});
      expect(existsSync(join(dir, 'spec.yaml'))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test('an arbitrary reply after preview is not accepted as approval', async () => {
    const {client, cleanup} = await makePair(dir);
    try {
      const {token} = await prepare(client, {mode: 'idea', intent: 'B2B payment SaaS'});
      const result = await client.callTool({name: 'clad_init', arguments: {
        token,
        confirmation: 'Which files will be created?',
        draft,
      }});
      expect(payload(result)).toMatchObject({status: 'confirmation_required', changed: false});
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

  test('a failed multi-file apply restores the pre-initialization workspace', async () => {
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

  test('tools-only MCP client drives init and clarify without sampling', async () => {
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

  test('document mode loads the full project-local planning document', async () => {
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

  test('document mode rejects a path that escapes the connected project', async () => {
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

  test('existing mode forces observed scanning for a sparse codebase', async () => {
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
    } finally {
      await cleanup();
    }
  });

  test('an initialized project returns without changing files unless refresh is explicit', async () => {
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

  test('clarify returns the next pending question as structured output', async () => {
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
