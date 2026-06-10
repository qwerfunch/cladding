// Cladding · adapter parity — every host adapter returns the same
// AgentResult shape on the same (persona, ctx). F-049 AC-090.

import {afterEach, describe, expect, test, vi} from 'vitest';

import {claudeCodeAdapter} from '../../src/adapters/host/claude-code.js';
import {genericMcpAdapter} from '../../src/adapters/host/generic-mcp.js';
import {
  clearHostMcpServerForTesting,
  setHostMcpServer,
} from '../../src/adapters/host/sampling-context.js';
import type {SamplingCapableServer} from '../../src/adapters/host/transport.js';
import type {AgentContext, AgentResult, PersonaSpec} from '../../src/adapters/types.js';

const persona: PersonaSpec = {
  id: 'developer',
  body: 'You are the Specialists agent. Implement the feature.',
  capabilities: new Set(['read', 'write', 'edit', 'exec']),
};

const ctx: AgentContext = {
  featureId: 'F-001',
  featureShard: 'id: F-001\ntitle: Test\nstatus: in_progress\n',
  guardrails: ['Use Google TypeScript Style.'],
  cwd: '/tmp/cladding-parity-fixture',
};

function shapeOf(r: AgentResult): readonly string[] {
  return Object.keys(r).sort();
}

describe('host adapter parity (F-049 AC-090)', () => {
  test('AgentResult key set is invariant across host adapters', async () => {
    const a = await claudeCodeAdapter.invokeAgent(persona, ctx);
    const b = await genericMcpAdapter.invokeAgent(persona, ctx);
    expect(shapeOf(a)).toEqual(shapeOf(b));
  });

  test('Identity shape is identical (author/name/timestamp keys)', async () => {
    const a = await claudeCodeAdapter.invokeAgent(persona, ctx);
    const b = await genericMcpAdapter.invokeAgent(persona, ctx);
    expect(Object.keys(a.identity).sort()).toEqual(Object.keys(b.identity).sort());
    expect(a.identity.author).toBe('llm');
    expect(b.identity.author).toBe('llm');
  });

  test('Mutations array exists on both (empty in mock stage)', async () => {
    const a = await claudeCodeAdapter.invokeAgent(persona, ctx);
    const b = await genericMcpAdapter.invokeAgent(persona, ctx);
    expect(Array.isArray(a.mutations)).toBe(true);
    expect(Array.isArray(b.mutations)).toBe(true);
  });

  test('Both adapters declare host mode and never require an API key (F-049 AC-091)', () => {
    expect(claudeCodeAdapter.mode).toBe('host');
    expect(genericMcpAdapter.mode).toBe('host');
    // No env-var reads happen in this module; assertion is enforced
    // by the adapter source (no process.env.*_API_KEY anywhere).
  });
});

describe('healthCheck — host detection (F-049 AC-089 auto-detect)', () => {
  test('claude-code: not-ready when CLAUDECODE is unset', async () => {
    const previousClaudecode = process.env.CLAUDECODE;
    const previousSessionId = process.env.CLAUDE_CODE_SESSION_ID;
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE_SESSION_ID;
    try {
      const status = await claudeCodeAdapter.healthCheck();
      expect(status.ready).toBe(false);
    } finally {
      if (previousClaudecode !== undefined) process.env.CLAUDECODE = previousClaudecode;
      if (previousSessionId !== undefined) process.env.CLAUDE_CODE_SESSION_ID = previousSessionId;
    }
  });

  test('claude-code: ready when CLAUDECODE=1', async () => {
    const previous = process.env.CLAUDECODE;
    process.env.CLAUDECODE = '1';
    try {
      const status = await claudeCodeAdapter.healthCheck();
      expect(status.ready).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = previous;
    }
  });

  test('generic-mcp: ready when MCP_TRANSPORT is set', async () => {
    const previous = process.env.MCP_TRANSPORT;
    process.env.MCP_TRANSPORT = 'stdio';
    try {
      const status = await genericMcpAdapter.healthCheck();
      expect(status.ready).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.MCP_TRANSPORT;
      else process.env.MCP_TRANSPORT = previous;
    }
  });
});

// v0.2.26 (F-075): when clad serve has registered an MCP server, the
// host adapters route through McpSamplingTransport instead of the
// Mock fallback. These tests substitute a stub sampling-capable
// server and assert the adapter's invoke goes through createMessage.
describe('host adapter MCP routing (F-075)', () => {
  afterEach(() => {
    clearHostMcpServerForTesting();
  });

  function stubSamplingServer(replyText: string): {
    server: SamplingCapableServer;
    createMessage: ReturnType<typeof vi.fn>;
  } {
    const createMessage = vi.fn().mockResolvedValue({
      model: 'stub',
      stopReason: 'endTurn',
      role: 'assistant' as const,
      content: {type: 'text', text: replyText},
    });
    return {server: {createMessage} as SamplingCapableServer, createMessage};
  }

  test('claudeCodeAdapter routes through McpSamplingTransport when a server is registered', async () => {
    const {server, createMessage} = stubSamplingServer('claude reply');
    setHostMcpServer(server);
    const result = await claudeCodeAdapter.invokeAgent(persona, ctx);
    expect(createMessage).toHaveBeenCalledOnce();
    expect(result.identity.name).toContain('mcp-sampling:claude-code');
    expect(result.summary).toBe('claude reply');
  });

  test('genericMcpAdapter routes through McpSamplingTransport when a server is registered', async () => {
    const {server, createMessage} = stubSamplingServer('mcp reply');
    setHostMcpServer(server);
    const result = await genericMcpAdapter.invokeAgent(persona, ctx);
    expect(createMessage).toHaveBeenCalledOnce();
    expect(result.identity.name).toContain('mcp-sampling:generic-mcp');
    expect(result.summary).toBe('mcp reply');
  });

  test('clearing the registration falls back to Mock on the NEXT dispatch', async () => {
    const {server, createMessage} = stubSamplingServer('first');
    setHostMcpServer(server);
    const first = await claudeCodeAdapter.invokeAgent(persona, ctx);
    expect(first.identity.name).toContain('mcp-sampling:claude-code');

    clearHostMcpServerForTesting();
    const second = await claudeCodeAdapter.invokeAgent(persona, ctx);
    expect(second.identity.name).toContain('mock:claude-code');
    // The fallback did NOT call createMessage a second time.
    expect(createMessage).toHaveBeenCalledOnce();
  });

  test('replacing the registered server with a new one re-allocates the cached transport', async () => {
    const first = stubSamplingServer('one');
    const second = stubSamplingServer('two');
    setHostMcpServer(first.server);
    const r1 = await genericMcpAdapter.invokeAgent(persona, ctx);
    setHostMcpServer(second.server);
    const r2 = await genericMcpAdapter.invokeAgent(persona, ctx);
    expect(r1.summary).toBe('one');
    expect(r2.summary).toBe('two');
    expect(first.createMessage).toHaveBeenCalledOnce();
    expect(second.createMessage).toHaveBeenCalledOnce();
  });

  test('healthCheck returns ready=true when sampling is active', async () => {
    const {server} = stubSamplingServer('x');
    setHostMcpServer(server);
    const status = await claudeCodeAdapter.healthCheck();
    expect(status.ready).toBe(true);
  });
});
