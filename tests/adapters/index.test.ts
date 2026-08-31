// Cladding · unit tests for adapters/index.ts
//
// resolveSelection walks the priority chain:
//   1. CLADDING_AGENT_MODE + CLADDING_AGENT_NAME env vars
//   2. .cladding/config.yaml agent.mode + agent.name
//   3. auto-detect (claude-code runtime → claude-code; else → generic-mcp)
//
// selectAdapter then instantiates the chosen adapter, falling back to
// generic-mcp when the chosen host name isn't registered (or when mode
// is 'sdk' — SDK adapters are not yet implemented).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/adapters/host/claude-code.js', () => ({
  claudeCodeAdapter: {name: 'claude-code', mode: 'host'},
  isClaudeCodeRuntime: vi.fn(),
}));
vi.mock('../../src/adapters/host/generic-mcp.js', () => ({
  genericMcpAdapter: {name: 'generic-mcp', mode: 'host'},
}));

const {resolveSelection, selectAdapter} = await import('../../src/adapters/index.js');
const claudeMod = await import('../../src/adapters/host/claude-code.js');
const isClaudeCodeRuntimeMock = claudeMod.isClaudeCodeRuntime as unknown as ReturnType<
  typeof vi.fn
>;

const ENV_KEYS = ['CLADDING_AGENT_MODE', 'CLADDING_AGENT_NAME'] as const;

describe('adapters/index — resolveSelection', () => {
  let dir: string;
  let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-adapter-'));
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    isClaudeCodeRuntimeMock.mockReset();
    isClaudeCodeRuntimeMock.mockReturnValue(false);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  test('[covers:F-049/AC-089] env vars take precedence over everything', () => {
    process.env.CLADDING_AGENT_MODE = 'sdk';
    process.env.CLADDING_AGENT_NAME = 'forced-by-env';
    isClaudeCodeRuntimeMock.mockReturnValue(true); // would normally win
    const r = resolveSelection(dir);
    expect(r).toEqual({mode: 'sdk', name: 'forced-by-env'});
  });

  test('[covers:F-049/AC-089] config.yaml wins when env is absent', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(
      join(dir, '.cladding', 'config.yaml'),
      'agent:\n  mode: host\n  name: claude-code\n',
    );
    const r = resolveSelection(dir);
    expect(r).toEqual({mode: 'host', name: 'claude-code'});
  });

  test('[covers:F-049/AC-089] config.yaml missing → auto-detect path (no claude-code runtime → generic-mcp)', () => {
    isClaudeCodeRuntimeMock.mockReturnValue(false);
    const r = resolveSelection(dir);
    expect(r).toEqual({mode: 'host', name: 'generic-mcp'});
  });

  test('[covers:F-049/AC-089] auto-detect: claude-code runtime → claude-code host', () => {
    isClaudeCodeRuntimeMock.mockReturnValue(true);
    const r = resolveSelection(dir);
    expect(r).toEqual({mode: 'host', name: 'claude-code'});
  });

  test('malformed config.yaml is tolerated → falls through to auto-detect', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'config.yaml'), 'agent: {oh no');
    isClaudeCodeRuntimeMock.mockReturnValue(false);
    const r = resolveSelection(dir);
    expect(r).toEqual({mode: 'host', name: 'generic-mcp'});
  });

  test('config.yaml with partial agent (no name) → falls through', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'config.yaml'), 'agent:\n  mode: host\n');
    const r = resolveSelection(dir);
    // Falls through to auto-detect
    expect(r.name).toBe('generic-mcp');
  });

  test('config.yaml without agent block → falls through', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'config.yaml'), 'something: else\n');
    const r = resolveSelection(dir);
    expect(r.name).toBe('generic-mcp');
  });

  test('env vars partial (only mode set) → falls through to config/auto-detect', () => {
    process.env.CLADDING_AGENT_MODE = 'host';
    // no NAME set
    const r = resolveSelection(dir);
    expect(r.name).toBe('generic-mcp'); // auto-detect default
  });
});

describe('adapters/index — selectAdapter', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-adapter-sel-'));
    for (const k of ENV_KEYS) delete process.env[k];
    isClaudeCodeRuntimeMock.mockReset();
    isClaudeCodeRuntimeMock.mockReturnValue(false);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('host mode + registered name → returns that adapter', () => {
    process.env.CLADDING_AGENT_MODE = 'host';
    process.env.CLADDING_AGENT_NAME = 'claude-code';
    const a = selectAdapter(dir);
    expect(a.name).toBe('claude-code');
  });

  test('host mode + unknown name → falls back to generic-mcp', () => {
    process.env.CLADDING_AGENT_MODE = 'host';
    process.env.CLADDING_AGENT_NAME = 'no-such-host';
    const a = selectAdapter(dir);
    expect(a.name).toBe('generic-mcp');
  });

  test('[covers:F-069/AC-188] sdk mode + claude-anthropic → returns the SDK adapter (v0.2.20)', () => {
    process.env.CLADDING_AGENT_MODE = 'sdk';
    process.env.CLADDING_AGENT_NAME = 'claude-anthropic';
    const a = selectAdapter(dir);
    expect(a.name).toBe('claude-anthropic');
    expect(a.mode).toBe('sdk');
  });

  test('sdk mode + unknown name → falls back to generic-mcp', () => {
    process.env.CLADDING_AGENT_MODE = 'sdk';
    process.env.CLADDING_AGENT_NAME = 'openai-gpt-4';
    const a = selectAdapter(dir);
    expect(a.name).toBe('generic-mcp');
  });

  test('no env + no config → auto-detect path returns generic-mcp default', () => {
    const a = selectAdapter(dir);
    expect(a.name).toBe('generic-mcp');
  });
});
