// Cladding · unit tests for translateCapabilities (0.4.11 PR-B).
//
// Covers the persona × host capability translation matrix:
//   - 5 cladding personas (orchestrator / librarian / reviewer /
//     observability / specialists) × 6 host targets (claude-code,
//     cursor, antigravity, codex, gemini, generic)
//   - capability-to-tool mapping (read → Read/Glob/Grep, write →
//     Write, edit → Edit, exec → Bash, dispatch → Task)
//   - hostHints overrides (sandbox_mode wins on Codex; permissionMode
//     emitted on Claude Code; maxTurns passed through everywhere)
//   - tier 3 generic gets the empty envelope
//
// The test imports loadPersona to round-trip the real persona files
// so the canonical frontmatter is in scope — translateCapabilities
// changes that drift from the real personas surface here.

import {describe, expect, test} from 'vitest';

import {translateCapabilities, type CapabilityEnvelope} from '../../src/agents/capabilities.js';
import {CLAUDE_STYLE_TOOLS, GEMINI_TOOLS, deriveCodexSandbox} from '../../src/agents/capability-map.js';
import {loadPersona} from '../../src/agents/loader.js';
import type {Capability, PersonaSpec} from '../../src/adapters/types.js';

function makePersona(
  id: string,
  capabilities: readonly Capability[],
  hostHints?: PersonaSpec['hostHints'],
): PersonaSpec {
  return {
    id,
    body: 'test body',
    capabilities: new Set(capabilities),
    ...(hostHints ? {hostHints} : {}),
  };
}

describe('capability-map — capability-to-tool tables', () => {
  test('Claude-style read → Read + Glob + Grep', () => {
    expect(CLAUDE_STYLE_TOOLS.read).toEqual(['Read', 'Glob', 'Grep']);
  });

  test('Claude-style exec → Bash (not granted on read-only personas)', () => {
    expect(CLAUDE_STYLE_TOOLS.exec).toEqual(['Bash']);
  });

  test('Claude-style dispatch → Task (orchestrator-only)', () => {
    expect(CLAUDE_STYLE_TOOLS.dispatch).toEqual(['Task']);
  });

  test('Gemini uses snake_case tool names', () => {
    expect(GEMINI_TOOLS.read).toEqual(['ReadFile', 'Glob', 'Grep']);
    expect(GEMINI_TOOLS.write).toEqual(['WriteFile']);
    expect(GEMINI_TOOLS.exec).toEqual(['Shell']);
    expect(GEMINI_TOOLS.dispatch).toEqual(['SubAgent']);
  });
});

describe('deriveCodexSandbox', () => {
  test('read-only when only read capability present', () => {
    expect(deriveCodexSandbox(new Set(['read']))).toBe('read-only');
  });

  test('workspace-write when write is granted', () => {
    expect(deriveCodexSandbox(new Set(['read', 'write']))).toBe('workspace-write');
  });

  test('workspace-write when edit is granted', () => {
    expect(deriveCodexSandbox(new Set(['read', 'edit']))).toBe('workspace-write');
  });

  test('workspace-write when exec is granted (implies tooling output)', () => {
    expect(deriveCodexSandbox(new Set(['read', 'exec']))).toBe('workspace-write');
  });

  test('never escalates to danger-full-access automatically', () => {
    expect(deriveCodexSandbox(new Set(['read', 'write', 'edit', 'exec', 'dispatch']))).toBe(
      'workspace-write',
    );
  });
});

describe('translateCapabilities — Claude Code', () => {
  test('librarian capability set → Read/Glob/Grep + Write + Edit + Bash', () => {
    const persona = makePersona('librarian', ['read', 'write', 'edit', 'exec']);
    const env = translateCapabilities(persona, 'claude-code');
    expect(env.host).toBe('claude-code');
    if (env.host !== 'claude-code') throw new Error('discriminated union assertion');
    expect(env.tools).toEqual(['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash']);
  });

  test('reviewer capability set → Read/Glob/Grep only (no write/edit/exec)', () => {
    const persona = makePersona('reviewer', ['read']);
    const env = translateCapabilities(persona, 'claude-code');
    if (env.host !== 'claude-code') throw new Error('discriminated union assertion');
    expect(env.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(env.tools).not.toContain('Write');
    expect(env.tools).not.toContain('Bash');
  });

  test('hostHints.permissionMode emitted verbatim', () => {
    const persona = makePersona('orchestrator', ['read', 'dispatch'], {permissionMode: 'plan'});
    const env = translateCapabilities(persona, 'claude-code');
    if (env.host !== 'claude-code') throw new Error('discriminated union assertion');
    expect(env.permissionMode).toBe('plan');
  });

  test('hostHints.maxTurns emitted verbatim', () => {
    const persona = makePersona('observability', ['read'], {maxTurns: 5});
    const env = translateCapabilities(persona, 'claude-code');
    if (env.host !== 'claude-code') throw new Error('discriminated union assertion');
    expect(env.maxTurns).toBe(5);
  });
});

describe('translateCapabilities — Cursor', () => {
  test('uses Claude-style tool names (same allowlist)', () => {
    const persona = makePersona('specialists', ['read', 'write', 'edit', 'exec']);
    const env = translateCapabilities(persona, 'cursor');
    expect(env.host).toBe('cursor');
    if (env.host !== 'cursor') throw new Error('discriminated union assertion');
    expect(env.tools).toContain('Read');
    expect(env.tools).toContain('Write');
    expect(env.tools).toContain('Edit');
    expect(env.tools).toContain('Bash');
  });

  test('no permissionMode field (Cursor envelope is narrower)', () => {
    const persona = makePersona('librarian', ['read', 'write'], {permissionMode: 'plan'});
    const env = translateCapabilities(persona, 'cursor');
    if (env.host !== 'cursor') throw new Error('discriminated union assertion');
    // @ts-expect-error — Cursor envelope intentionally omits permissionMode.
    expect(env.permissionMode).toBeUndefined();
  });
});

describe('translateCapabilities — Antigravity', () => {
  test('uses Claude-style tool names (Antigravity inherits Claude convention)', () => {
    const persona = makePersona('specialists', ['read', 'write']);
    const env = translateCapabilities(persona, 'antigravity');
    expect(env.host).toBe('antigravity');
    if (env.host !== 'antigravity') throw new Error('discriminated union assertion');
    expect(env.tools).toContain('Read');
    expect(env.tools).toContain('Write');
  });
});

describe('translateCapabilities — Codex', () => {
  test('write capability → sandbox_mode workspace-write + cladding MCP', () => {
    const persona = makePersona('specialists', ['read', 'write', 'edit', 'exec']);
    const env = translateCapabilities(persona, 'codex');
    expect(env.host).toBe('codex');
    if (env.host !== 'codex') throw new Error('discriminated union assertion');
    expect(env.sandboxMode).toBe('workspace-write');
    expect(env.mcpServers).toEqual(['cladding']);
  });

  test('read-only persona → sandbox_mode read-only', () => {
    const persona = makePersona('reviewer', ['read']);
    const env = translateCapabilities(persona, 'codex');
    if (env.host !== 'codex') throw new Error('discriminated union assertion');
    expect(env.sandboxMode).toBe('read-only');
  });

  test('hostHints.sandbox_mode overrides derivation', () => {
    // Persona has only read capability (would derive 'read-only') but
    // declares 'workspace-write' explicitly — the explicit value wins.
    const persona = makePersona('observability', ['read'], {sandbox_mode: 'workspace-write'});
    const env = translateCapabilities(persona, 'codex');
    if (env.host !== 'codex') throw new Error('discriminated union assertion');
    expect(env.sandboxMode).toBe('workspace-write');
  });

  test('hostHints.sandbox_mode can escalate to danger-full-access', () => {
    const persona = makePersona('specialists', ['read', 'write'], {sandbox_mode: 'danger-full-access'});
    const env = translateCapabilities(persona, 'codex');
    if (env.host !== 'codex') throw new Error('discriminated union assertion');
    expect(env.sandboxMode).toBe('danger-full-access');
  });
});

describe('translateCapabilities — Gemini', () => {
  test('emits allowed_tools with snake_case names', () => {
    const persona = makePersona('specialists', ['read', 'write', 'edit', 'exec']);
    const env = translateCapabilities(persona, 'gemini');
    expect(env.host).toBe('gemini');
    if (env.host !== 'gemini') throw new Error('discriminated union assertion');
    expect(env.allowedTools).toEqual(['ReadFile', 'Glob', 'Grep', 'WriteFile', 'EditFile', 'Shell']);
  });

  test('orchestrator dispatch → SubAgent in allowed_tools', () => {
    const persona = makePersona('orchestrator', ['read', 'dispatch']);
    const env = translateCapabilities(persona, 'gemini');
    if (env.host !== 'gemini') throw new Error('discriminated union assertion');
    expect(env.allowedTools).toContain('SubAgent');
  });
});

describe('translateCapabilities — Generic (Tier 3)', () => {
  test('returns empty envelope (no enforcement)', () => {
    const persona = makePersona('librarian', ['read', 'write', 'edit', 'exec']);
    const env = translateCapabilities(persona, 'generic');
    expect(env).toEqual({host: 'generic'});
  });

  test('hostHints are not surfaced on generic', () => {
    const persona = makePersona('reviewer', ['read'], {permissionMode: 'plan', maxTurns: 3});
    const env = translateCapabilities(persona, 'generic');
    expect(env).toEqual({host: 'generic'});
  });
});

describe('translateCapabilities — real persona round-trip', () => {
  test('orchestrator → Claude Code envelope has Task + permissionMode=plan', () => {
    const persona = loadPersona('orchestrator');
    const env = translateCapabilities(persona, 'claude-code') as Extract<
      CapabilityEnvelope,
      {host: 'claude-code'}
    >;
    expect(env.host).toBe('claude-code');
    expect(env.tools).toContain('Task');
    expect(env.permissionMode).toBe('plan');
  });

  test('reviewer → Codex envelope is read-only sandbox', () => {
    const persona = loadPersona('reviewer');
    const env = translateCapabilities(persona, 'codex') as Extract<CapabilityEnvelope, {host: 'codex'}>;
    expect(env.host).toBe('codex');
    expect(env.sandboxMode).toBe('read-only');
    expect(env.maxTurns).toBe(3);
  });

  test('librarian → Cursor envelope has Write + Edit + Bash', () => {
    const persona = loadPersona('librarian');
    const env = translateCapabilities(persona, 'cursor') as Extract<CapabilityEnvelope, {host: 'cursor'}>;
    expect(env.host).toBe('cursor');
    expect(env.tools).toContain('Write');
    expect(env.tools).toContain('Edit');
    expect(env.tools).toContain('Bash');
  });
});
