// Cladding · unit tests for cli/scan/dispatcher.ts (v0.3.33)
//
// Contract: selectDispatcher walks the priority chain (MCP sampling →
// Anthropic SDK → null) and the Anthropic dispatcher returned by the
// SDK branch concatenates `text` blocks verbatim. Both branches must
// honour `--no-llm` (returns null without inspecting environment).

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {selectDispatcher} from '../../src/cli/scan/dispatcher.js';
import {setHostMcpServer} from '../../src/adapters/host/sampling-context.js';
import type {SamplingCapableServer} from '../../src/adapters/host/transport.js';

function fakeSamplingServer(reply: string): SamplingCapableServer {
  return {
    async createMessage() {
      return {
        model: 'fake-model',
        role: 'assistant' as const,
        content: {type: 'text' as const, text: reply},
      };
    },
  };
}

describe('selectDispatcher', () => {
  let restoreEnv: string | undefined;

  beforeEach(() => {
    restoreEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    setHostMcpServer(null);
  });

  afterEach(() => {
    if (restoreEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = restoreEnv;
    setHostMcpServer(null);
    vi.restoreAllMocks();
  });

  test('returns null when noLlm is true even with API key present', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-noop';
    expect(selectDispatcher({noLlm: true})).toBeNull();
  });

  test('returns null when no MCP server and no API key', () => {
    expect(selectDispatcher()).toBeNull();
  });

  test('returns null when noLlm is true via option override', () => {
    expect(selectDispatcher({noLlm: true, apiKey: 'sk-explicit'})).toBeNull();
  });

  test('honours explicit apiKey override over process.env', () => {
    const dispatcher = selectDispatcher({apiKey: 'sk-override'});
    expect(typeof dispatcher).toBe('function');
  });

  test('returns a dispatcher when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-fake';
    const dispatcher = selectDispatcher();
    expect(typeof dispatcher).toBe('function');
  });

  // v0.3.34 — MCP sampling wins over the Anthropic SDK fallback so
  // hosted environments (clad serve + Claude Code/Cursor/Continue)
  // don't need cladding to hold its own API credentials.
  test('MCP server registration takes priority over ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-be-used';
    setHostMcpServer(fakeSamplingServer('mcp-reply'));
    const dispatcher = selectDispatcher();
    expect(typeof dispatcher).toBe('function');
    const text = await dispatcher!('hello');
    expect(text).toBe('mcp-reply');
  });

  test('MCP dispatcher passes the prompt verbatim through createMessage', async () => {
    let received = '';
    setHostMcpServer({
      async createMessage(params) {
        received = params.messages[0].content.text;
        return {
          model: 'fake',
          role: 'assistant' as const,
          content: {type: 'text' as const, text: 'ok'},
        };
      },
    });
    const dispatcher = selectDispatcher();
    await dispatcher!('the exact prompt');
    expect(received).toBe('the exact prompt');
  });

  test('MCP dispatcher returns empty string when the reply has no text block', async () => {
    setHostMcpServer({
      async createMessage() {
        return {
          model: 'fake',
          role: 'assistant' as const,
          content: {type: 'image', data: 'unused'} as unknown as {type: 'text'; text: string},
        };
      },
    });
    const dispatcher = selectDispatcher();
    const text = await dispatcher!('hello');
    expect(text).toBe('');
  });

  test('--no-llm still wins over an MCP registration', () => {
    setHostMcpServer(fakeSamplingServer('mcp-reply'));
    expect(selectDispatcher({noLlm: true})).toBeNull();
  });
});
