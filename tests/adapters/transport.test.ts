// Cladding · unit tests for src/adapters/host/transport.ts (F-068)
//
// The Transport layer is the swap-point for v0.2.20 real bodies.
// v0.2.19 ships only MockTransport, so the tests cover the mock's
// observable behaviour:
//   - invoke returns an AgentResult with identity + summary
//   - identity.name uses the host-tagged form `mock:<hostName>:<persona>`
//   - mutations is empty (mock has no fs side-effects)
//   - ready() honours the readyWhen predicate
//   - ready() returns the configured reason when not ready

import {describe, expect, test, vi} from 'vitest';

import type {AgentContext, PersonaSpec} from '../../src/adapters/types.js';
import {
  McpSamplingTransport,
  MockTransport,
  type SamplingCapableServer,
} from '../../src/adapters/host/transport.js';

const PERSONA: PersonaSpec = {id: 'reviewer', body: '', capabilities: new Set()};
const CTX: AgentContext = {featureId: 'F-001', featureShard: '{}', guardrails: [], cwd: '.'};

describe('MockTransport', () => {
  test('id reflects hostName with the mock: prefix', () => {
    const t = new MockTransport({
      hostName: 'claude-code',
      readyWhen: () => true,
      notReadyReason: 'never',
    });
    expect(t.id).toBe('mock:claude-code');
  });

  test('[covers:F-068/AC-183][covers:F-068/AC-186] invoke returns AgentResult with llm identity + tagged name', async () => {
    const t = new MockTransport({
      hostName: 'claude-code',
      readyWhen: () => true,
      notReadyReason: 'never',
    });
    const r = await t.invoke(PERSONA, CTX);
    expect(r.identity.author).toBe('llm');
    expect(r.identity.name).toBe('mock:claude-code:reviewer');
    expect(r.identity.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(r.summary).toContain('persona=reviewer');
    expect(r.summary).toContain('feature=F-001');
  });

  test('invoke returns empty mutations (mock has no fs side-effects)', async () => {
    const t = new MockTransport({
      hostName: 'generic-mcp',
      readyWhen: () => true,
      notReadyReason: 'never',
    });
    const r = await t.invoke(PERSONA, CTX);
    expect(r.mutations).toEqual([]);
  });

  test('ready resolves true when the predicate is true', async () => {
    const t = new MockTransport({
      hostName: 'h',
      readyWhen: () => true,
      notReadyReason: 'never',
    });
    const r = await t.ready();
    expect(r.ready).toBe(true);
  });

  test('ready resolves false with the configured reason when predicate is false', async () => {
    const t = new MockTransport({
      hostName: 'h',
      readyWhen: () => false,
      notReadyReason: 'no host detected',
    });
    const r = await t.ready();
    expect(r.ready).toBe(false);
    expect(r.reason).toBe('no host detected');
  });

  test('predicate is evaluated each call (not cached)', async () => {
    let flag = false;
    const t = new MockTransport({
      hostName: 'h',
      readyWhen: () => flag,
      notReadyReason: 'flag off',
    });
    expect((await t.ready()).ready).toBe(false);
    flag = true;
    expect((await t.ready()).ready).toBe(true);
  });

  test('different hostName yields distinct identity.name across two transports', async () => {
    const t1 = new MockTransport({hostName: 'a', readyWhen: () => true, notReadyReason: ''});
    const t2 = new MockTransport({hostName: 'b', readyWhen: () => true, notReadyReason: ''});
    const r1 = await t1.invoke(PERSONA, CTX);
    const r2 = await t2.invoke(PERSONA, CTX);
    expect(r1.identity.name).not.toBe(r2.identity.name);
    expect(r1.identity.name).toContain('mock:a');
    expect(r2.identity.name).toContain('mock:b');
  });
});

describe('McpSamplingTransport (F-074, v0.2.25)', () => {
  function makeServer(reply: {
    text: string;
    model?: string;
    stopReason?: string;
  }): {server: SamplingCapableServer; createMessage: ReturnType<typeof vi.fn>} {
    const createMessage = vi.fn().mockResolvedValue({
      model: reply.model ?? 'test-model',
      stopReason: reply.stopReason ?? 'endTurn',
      role: 'assistant' as const,
      content: {type: 'text', text: reply.text},
    });
    return {server: {createMessage} as SamplingCapableServer, createMessage};
  }

  test('id defaults to mcp-sampling:host', () => {
    const {server} = makeServer({text: 'ok'});
    const t = new McpSamplingTransport(server);
    expect(t.id).toBe('mcp-sampling:host');
  });

  test('id can be overridden via options', () => {
    const {server} = makeServer({text: 'ok'});
    const t = new McpSamplingTransport(server, {id: 'mcp-sampling:claude-code'});
    expect(t.id).toBe('mcp-sampling:claude-code');
  });

  test('[covers:F-074/AC-211] invoke calls createMessage with persona body as system prompt', async () => {
    const {server, createMessage} = makeServer({text: 'reply text'});
    const t = new McpSamplingTransport(server);
    const persona: PersonaSpec = {id: 'reviewer', body: 'You are the reviewer.', capabilities: new Set()};
    await t.invoke(persona, CTX);
    const call = createMessage.mock.calls[0][0];
    expect(call.systemPrompt).toBe('You are the reviewer.');
    expect(call.maxTokens).toBe(16384);
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe('user');
    expect(call.messages[0].content.type).toBe('text');
    expect(call.messages[0].content.text).toContain('F-001');
  });

  test('[covers:F-074/AC-212] invoke maps the sampling reply to AgentResult shape', async () => {
    const {server} = makeServer({text: 'persona output', model: 'claude-x', stopReason: 'endTurn'});
    const t = new McpSamplingTransport(server);
    const result = await t.invoke(PERSONA, CTX);
    expect(result.identity.author).toBe('llm');
    expect(result.identity.name).toBe('mcp-sampling:host:reviewer');
    expect(result.summary).toBe('persona output');
    expect(result.mutations).toEqual([]);
    expect(result.notes).toContain('model=claude-x');
    expect(result.notes).toContain('stop=endTurn');
  });

  test('invoke truncates the summary to 200 chars', async () => {
    const long = 'x'.repeat(500);
    const {server} = makeServer({text: long});
    const t = new McpSamplingTransport(server);
    const result = await t.invoke(PERSONA, CTX);
    expect(result.summary).toHaveLength(200);
  });

  test('invoke handles non-text reply by returning an empty summary', async () => {
    const createMessage = vi.fn().mockResolvedValue({
      model: 'x',
      stopReason: 'toolUse',
      role: 'assistant' as const,
      content: {type: 'toolUse', name: 'unknown'},
    });
    const server = {createMessage} as SamplingCapableServer;
    const t = new McpSamplingTransport(server);
    const result = await t.invoke(PERSONA, CTX);
    expect(result.summary).toBe('');
  });

  test('invoke includes guardrails in the user message when present', async () => {
    const {server, createMessage} = makeServer({text: 'ok'});
    const t = new McpSamplingTransport(server);
    const ctxWithGuards: AgentContext = {
      ...CTX,
      guardrails: ['No mocks in integration tests', 'Use TSDoc on every export'],
    };
    await t.invoke(PERSONA, ctxWithGuards);
    const text = createMessage.mock.calls[0][0].messages[0].content.text;
    expect(text).toContain('Guardrails:');
    expect(text).toContain('No mocks');
    expect(text).toContain('Use TSDoc');
  });

  test('ready() resolves true (probe is via first invoke)', async () => {
    const {server} = makeServer({text: 'ok'});
    const t = new McpSamplingTransport(server);
    const status = await t.ready();
    expect(status.ready).toBe(true);
  });

  test('maxTokens override is forwarded to createMessage', async () => {
    const {server, createMessage} = makeServer({text: 'ok'});
    const t = new McpSamplingTransport(server, {maxTokens: 1024});
    await t.invoke(PERSONA, CTX);
    expect(createMessage.mock.calls[0][0].maxTokens).toBe(1024);
  });

  test('invoke propagates transport errors so the loop can classify them', async () => {
    const createMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('429: sampling rate limit exceeded'));
    const server = {createMessage} as SamplingCapableServer;
    const t = new McpSamplingTransport(server);
    await expect(t.invoke(PERSONA, CTX)).rejects.toThrow(/rate limit/);
  });
});
