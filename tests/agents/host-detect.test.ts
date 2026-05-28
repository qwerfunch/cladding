// Cladding · unit tests for src/agents/host-detect.ts (0.4.10 PR-A.2)

import {describe, expect, test} from 'vitest';

import {detectHost} from '../../src/agents/host-detect.js';

describe('detectHost', () => {
  test('empty env → generic Tier 3', () => {
    const result = detectHost({});
    expect(result.host).toBe('generic');
    expect(result.tier).toBe(3);
    expect(result.signals).toEqual([]);
    expect(result.overridden).toBe(false);
  });

  test('CLAUDECODE=1 → claude-code Tier 1', () => {
    const result = detectHost({CLAUDECODE: '1'});
    expect(result.host).toBe('claude-code');
    expect(result.tier).toBe(1);
    expect(result.signals).toEqual(['CLAUDECODE']);
  });

  test('CLAUDECODE=true (alt truthy) → claude-code', () => {
    const result = detectHost({CLAUDECODE: 'true'});
    expect(result.host).toBe('claude-code');
  });

  test('CODEX_HOME → codex Tier 1', () => {
    const result = detectHost({CODEX_HOME: '/some/path'});
    expect(result.host).toBe('codex');
    expect(result.tier).toBe(1);
    expect(result.signals).toContain('CODEX_HOME');
  });

  test('CURSOR_SESSION → cursor Tier 1', () => {
    const result = detectHost({CURSOR_SESSION: 'abc'});
    expect(result.host).toBe('cursor');
    expect(result.tier).toBe(1);
  });

  test('TERM_PROGRAM=cursor → cursor', () => {
    const result = detectHost({TERM_PROGRAM: 'cursor'});
    expect(result.host).toBe('cursor');
    expect(result.signals).toContain('TERM_PROGRAM=cursor');
  });

  test('GEMINI_HOME → gemini Tier 2', () => {
    const result = detectHost({GEMINI_HOME: '/x'});
    expect(result.host).toBe('gemini');
    expect(result.tier).toBe(2);
  });

  test('ANTIGRAVITY_HOME → antigravity Tier 1', () => {
    const result = detectHost({ANTIGRAVITY_HOME: '/x'});
    expect(result.host).toBe('antigravity');
    expect(result.tier).toBe(1);
  });

  test('Antigravity wins over Claude Code when both set (priority order)', () => {
    const result = detectHost({CLAUDECODE: '1', ANTIGRAVITY_HOME: '/x'});
    expect(result.host).toBe('antigravity');
  });

  test('CLADDING_HOST override beats env signals', () => {
    const result = detectHost({CLAUDECODE: '1', CLADDING_HOST: 'gemini'});
    expect(result.host).toBe('gemini');
    expect(result.tier).toBe(2);
    expect(result.overridden).toBe(true);
    expect(result.signals).toEqual(['CLADDING_HOST']);
  });

  test('CLADDING_HOST=generic forces Tier 3 fallback', () => {
    const result = detectHost({CLAUDECODE: '1', CLADDING_HOST: 'generic'});
    expect(result.host).toBe('generic');
    expect(result.tier).toBe(3);
  });

  test('invalid CLADDING_HOST value is ignored (falls back to env signals)', () => {
    const result = detectHost({CLAUDECODE: '1', CLADDING_HOST: 'not-a-real-host'});
    expect(result.host).toBe('claude-code');
    expect(result.overridden).toBe(false);
  });

  test('CLADDING_HOST is case-insensitive', () => {
    const result = detectHost({CLADDING_HOST: 'CODEX'});
    expect(result.host).toBe('codex');
    expect(result.overridden).toBe(true);
  });

  test('Codex wins over Cursor when both env present (priority order)', () => {
    const result = detectHost({CODEX_HOME: '/x', CURSOR_SESSION: 'y'});
    expect(result.host).toBe('codex');
  });

  test('multiple Codex signals all reported', () => {
    const result = detectHost({CODEX_HOME: '/x', CODEX_CONFIG: '/y'});
    expect(result.signals).toEqual(['CODEX_HOME', 'CODEX_CONFIG']);
  });

  test('empty-string env value not counted as signal', () => {
    const result = detectHost({CODEX_HOME: '', GEMINI_HOME: '/x'});
    expect(result.host).toBe('gemini');
  });
});
