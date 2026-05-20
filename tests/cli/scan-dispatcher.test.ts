// Cladding · unit tests for cli/scan/dispatcher.ts (v0.3.33)
//
// Contract: selectDispatcher walks the priority chain (MCP sampling →
// Anthropic SDK → null) and the Anthropic dispatcher returned by the
// SDK branch concatenates `text` blocks verbatim. Both branches must
// honour `--no-llm` (returns null without inspecting environment).

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {selectDispatcher} from '../../src/cli/scan/dispatcher.js';
import {setHostMcpServer} from '../../src/adapters/host/sampling-context.js';

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
});
