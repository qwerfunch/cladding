// Cladding · unit tests for src/adapters/sdk/anthropic.ts (F-069)
//
// First real-LLM transport. Tests use the clientFactory injection
// seam to substitute an in-memory AnthropicLike so no network call
// fires + ANTHROPIC_API_KEY can be controlled per test.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import type {AgentContext, PersonaSpec} from '../../src/adapters/types.js';
import {AnthropicTransport} from '../../src/adapters/sdk/anthropic.js';

const PERSONA: PersonaSpec = {id: 'reviewer', body: 'You are a code reviewer.', capabilities: new Set()};
const CTX: AgentContext = {
  featureId: 'F-001',
  featureShard: '{"id":"F-001","title":"t"}',
  guardrails: ['No edits outside src/'],
  cwd: '.',
};

// Returns a fake Anthropic client whose create() resolves a fixed
// reply. The factory cast uses `unknown` to bridge vi.fn()'s
// generic return type and AnthropicTransport's internal AnthropicLike
// contract — that contract is private to the transport file.
type FakeClient = {messages: {create: ReturnType<typeof vi.fn>}};
function makeFakeClient(
  replyText: string,
  stopReason = 'end_turn',
): {client: FakeClient; factory: (apiKey: string) => unknown} {
  const create = vi.fn().mockResolvedValue({
    content: [{type: 'text', text: replyText}],
    stop_reason: stopReason,
  });
  const client: FakeClient = {messages: {create}};
  return {
    client,
    factory: (_apiKey: string) => client,
  };
}

describe('AnthropicTransport', () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  test('id is sdk:claude-anthropic', () => {
    const t = new AnthropicTransport({apiKey: 'sk-test'});
    expect(t.id).toBe('sdk:claude-anthropic');
  });

  test('ready() returns false with reason when no API key set', async () => {
    const t = new AnthropicTransport();
    const r = await t.ready();
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('ANTHROPIC_API_KEY');
  });

  test('ready() returns true when API key is provided', async () => {
    const t = new AnthropicTransport({apiKey: 'sk-test'});
    const r = await t.ready();
    expect(r.ready).toBe(true);
  });

  test('ready() picks up env var when constructor option omitted', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env';
    const t = new AnthropicTransport();
    const r = await t.ready();
    expect(r.ready).toBe(true);
  });

  test('invoke throws clear error when API key is missing', async () => {
    const t = new AnthropicTransport();
    await expect(t.invoke(PERSONA, CTX)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  test('[covers:F-069/AC-189] missing credentials make ready and invoke report the same API-key failure', async () => {
    const t = new AnthropicTransport();
    const readiness = await t.ready();

    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toContain('ANTHROPIC_API_KEY');
    await expect(t.invoke(PERSONA, CTX)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  test('invoke returns AgentResult with llm identity + tagged name', async () => {
    const {factory} = makeFakeClient('Looks good. Approved.');
    const t = new AnthropicTransport({apiKey: 'sk-test', clientFactory: factory as never});
    const r = await t.invoke(PERSONA, CTX);
    expect(r.identity.author).toBe('llm');
    expect(r.identity.name).toBe('sdk:claude-anthropic:reviewer');
    expect(r.summary).toBe('Looks good. Approved.');
    expect(r.mutations).toEqual([]);
    expect(r.notes).toContain('model=');
  });

  test('invoke forwards persona body as system message + ctx as user message', async () => {
    const {client, factory} = makeFakeClient('ok');
    const t = new AnthropicTransport({apiKey: 'sk-test', clientFactory: factory as never});
    await t.invoke(PERSONA, CTX);
    expect(client.messages.create).toHaveBeenCalledOnce();
    const args = client.messages.create.mock.calls[0]?.[0];
    // B3: persona prefix is sent as an ephemeral-cached system block (stable across
    // dispatches → repeat calls re-read it from cache instead of re-billing it).
    expect(args.system).toEqual([{type: 'text', text: 'You are a code reviewer.', cache_control: {type: 'ephemeral'}}]);
    expect(args.messages[0].role).toBe('user');
    expect(args.messages[0].content).toContain('F-001');
    expect(args.messages[0].content).toContain('No edits outside src/');
  });

  test('[covers:F-069/AC-190] invoke preserves the request shape while truncating summary and recording stop reason', async () => {
    const {client, factory} = makeFakeClient('x'.repeat(250), 'max_tokens');
    const t = new AnthropicTransport({apiKey: 'sk-test', clientFactory: factory as never});
    const result = await t.invoke(PERSONA, CTX);
    const args = client.messages.create.mock.calls[0]?.[0];

    expect(args.system[0].text).toBe(PERSONA.body);
    expect(args.messages[0].content).toContain(CTX.featureShard);
    expect(args.messages[0].content).toContain(CTX.guardrails[0]);
    expect(result.summary).toHaveLength(200);
    expect(result.notes).toContain('stop=max_tokens');
  });

  test('[covers:F-069/AC-191] client is cached across invocations (factory called once)', async () => {
    const factory = vi.fn().mockReturnValue({
      messages: {create: vi.fn().mockResolvedValue({content: [{type: 'text', text: 'ok'}]})},
    });
    const t = new AnthropicTransport({apiKey: 'sk-test', clientFactory: factory as never});
    await t.invoke(PERSONA, CTX);
    await t.invoke(PERSONA, CTX);
    expect(factory).toHaveBeenCalledOnce();
  });

  test('summary truncates long responses to 200 chars', async () => {
    const long = 'x'.repeat(500);
    const {factory} = makeFakeClient(long);
    const t = new AnthropicTransport({apiKey: 'sk-test', clientFactory: factory as never});
    const r = await t.invoke(PERSONA, CTX);
    expect(r.summary.length).toBe(200);
  });

  test('model + maxTokens defaults can be overridden', async () => {
    const {client, factory} = makeFakeClient('ok');
    const t = new AnthropicTransport({
      apiKey: 'sk-test',
      clientFactory: factory as never,
      model: 'claude-sonnet-4-6',
      maxTokens: 1024,
    });
    await t.invoke(PERSONA, CTX);
    const args = client.messages.create.mock.calls[0]?.[0];
    expect(args.model).toBe('claude-sonnet-4-6');
    expect(args.max_tokens).toBe(1024);
  });

  test('stop_reason surfaces in notes', async () => {
    const {factory} = makeFakeClient('ok', 'max_tokens');
    const t = new AnthropicTransport({apiKey: 'sk-test', clientFactory: factory as never});
    const r = await t.invoke(PERSONA, CTX);
    expect(r.notes).toContain('stop=max_tokens');
  });
});
