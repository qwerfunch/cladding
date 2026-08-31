// Cladding · unit tests for cli/scan/dispatcher.ts (v0.3.33)
//
// Contract: selectDispatcher walks the priority chain (MCP sampling →
// Anthropic SDK → null) and the Anthropic dispatcher returned by the
// SDK branch concatenates `text` blocks verbatim. Both branches must
// honour `--no-llm` (returns null without inspecting environment).

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {selectDispatcher, DEFAULT_MODEL, DEFAULT_MAX_TOKENS, resolveModel} from '../../src/cli/scan/dispatcher.js';
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
  // selectDispatcher walks four provider lanes (Anthropic, OpenAI, Gemini,
  // Google — F-90d054 v0.3.60). Any provider key present in the ambient
  // environment would make `selectDispatcher()` return a live dispatcher and
  // break the "no key" assertions, so snapshot and clear ALL of them, not just
  // ANTHROPIC_API_KEY.
  const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const;
  let restoreEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    restoreEnv = {};
    for (const k of PROVIDER_KEYS) {
      restoreEnv[k] = process.env[k];
      delete process.env[k];
    }
    setHostMcpServer(null);
  });

  afterEach(() => {
    for (const k of PROVIDER_KEYS) {
      if (restoreEnv[k] === undefined) delete process.env[k];
      else process.env[k] = restoreEnv[k];
    }
    setHostMcpServer(null);
    vi.restoreAllMocks();
  });

  test('[covers:F-7fa4a7/AC-003] returns null when noLlm is true even with API key present', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-noop';
    expect(selectDispatcher({noLlm: true})).toBeNull();
  });

  test('returns null when no MCP server and no API key', () => {
    expect(selectDispatcher()).toBeNull();
  });

  test('[covers:F-417ff0/AC-002] returns null when noLlm is true via option override', () => {
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
  test('[covers:F-7fa4a7/AC-002] MCP server registration takes priority over ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-be-used';
    setHostMcpServer(fakeSamplingServer('mcp-reply'));
    const dispatcher = selectDispatcher();
    expect(typeof dispatcher).toBe('function');
    const text = await dispatcher!('hello');
    expect(text).toBe('mcp-reply');
  });

  test('[covers:F-7fa4a7/AC-001] MCP dispatcher passes the prompt verbatim through createMessage', async () => {
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

  test('[covers:F-417ff0/AC-001] MCP sampling wins, an injected direct client refines with only an API key, and offline stays deterministic', async () => {
    let samplingCalls = 0;
    let directClientCalls = 0;
    setHostMcpServer({
      async createMessage() {
        samplingCalls += 1;
        return {
          model: 'host-selected-model',
          role: 'assistant' as const,
          content: {type: 'text' as const, text: 'MCP refinement'},
        };
      },
    });
    const mcp = selectDispatcher({
      apiKey: 'direct-only-test-key',
      createAnthropicClient: () => {
        directClientCalls += 1;
        throw new Error('MCP must win before the direct client is constructed.');
      },
    });
    expect(mcp).toEqual(expect.any(Function));
    await expect(mcp!('refine through the host')).resolves.toBe('MCP refinement');
    expect(samplingCalls).toBe(1);
    expect(directClientCalls).toBe(0);

    setHostMcpServer(null);
    let directConfig: {apiKey: string} | undefined;
    let directRequest: {model: string; max_tokens: number; messages: {role: 'user'; content: string}[]} | undefined;
    const direct = selectDispatcher({
      apiKey: 'direct-only-test-key',
      model: 'local-direct-model',
      createAnthropicClient: (config) => {
        directConfig = config;
        return {
          messages: {
            async create(request) {
              directRequest = request;
              return {content: [{type: 'text', text: 'Direct refinement'}]};
            },
          },
        };
      },
    });
    expect(direct).toEqual(expect.any(Function));
    await expect(direct!('refine through the direct client')).resolves.toBe('Direct refinement');
    expect(directConfig).toEqual({apiKey: 'direct-only-test-key'});
    expect(directRequest).toEqual({
      model: 'local-direct-model',
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: [{role: 'user', content: 'refine through the direct client'}],
    });

    expect(selectDispatcher()).toBeNull();
  });

  test('[covers:F-7fa4a7/AC-004] MCP dispatcher returns empty string when the reply has no text block', async () => {
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

// ─── F-b43066 — current-generation defaults + config-file model override ───

describe('model resolution (F-b43066)', () => {
  test('defaults are current-generation with a 16k output ceiling', () => {
    expect(DEFAULT_MODEL).toBe('claude-sonnet-4-6');
    expect(DEFAULT_MAX_TOKENS).toBe(16384);
  });

  test('precedence: explicit opts.model > config agent.model > built-in default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-model-'));
    try {
      // no config → default
      expect(resolveModel(undefined, dir)).toBe(DEFAULT_MODEL);
      // config present → config wins over default
      mkdirSync(join(dir, '.cladding'), {recursive: true});
      writeFileSync(join(dir, '.cladding', 'config.yaml'), 'agent:\n  mode: sdk\n  model: claude-opus-4-8\n');
      expect(resolveModel(undefined, dir)).toBe('claude-opus-4-8');
      // explicit always wins
      expect(resolveModel('claude-haiku-4-5-20251001', dir)).toBe('claude-haiku-4-5-20251001');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('a malformed config file degrades to the default (never throws)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-model-bad-'));
    try {
      mkdirSync(join(dir, '.cladding'), {recursive: true});
      writeFileSync(join(dir, '.cladding', 'config.yaml'), ':::not yaml at all\n');
      expect(resolveModel(undefined, dir)).toBe(DEFAULT_MODEL);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
