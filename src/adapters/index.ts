// Cladding · Agent adapter selector
//
// Resolves the active {@link AgentAdapter} from configuration. The
// default is host-bound (no API key) with runtime auto-detection;
// SDK adapters are opt-in via explicit `agent.mode = sdk`.
//
// Resolution order (first match wins):
//   1. Environment variables — `CLADDING_AGENT_MODE` +
//      `CLADDING_AGENT_NAME`. Useful for ephemeral overrides.
//   2. `.cladding/config.yaml` keys `agent.mode` and `agent.name`.
//      The project-level pin.
//   3. Auto-detect — `claude-code` when the runtime looks like
//      Claude Code, otherwise `generic-mcp`.
//
// The selector does not call an LLM and does not throw on missing
// config — it always returns *some* adapter so drive/agent.ts can
// proceed and let healthCheck() decide whether to halt the loop
// with LLM_UNAVAILABLE.
//
// @see spec/features/F-049.yaml AC-089 — adapter selection rules.
// @see docs/multi-provider-roadmap.md — the adapter matrix.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';

import {parse as parseYaml} from 'yaml';

import {claudeCodeAdapter, isClaudeCodeRuntime} from './host/claude-code.js';
import {genericMcpAdapter} from './host/generic-mcp.js';
import {claudeAnthropicAdapter} from './sdk/anthropic.js';
import type {AdapterMode, AgentAdapter} from './types.js';

/** All host adapters known to cladding, keyed by `name`. */
const HOST_REGISTRY: Readonly<Record<string, AgentAdapter>> = {
  'claude-code': claudeCodeAdapter,
  'generic-mcp': genericMcpAdapter,
};

/**
 * SDK adapters — opt-in via `agent.mode === 'sdk'`. Each entry talks
 * to its vendor's API directly using an API key supplied via env.
 * v0.2.20 (F-069) ships the `claude-anthropic` entry; other vendors
 * (openai, google-gemini) are reserved slots filled in later.
 */
const SDK_REGISTRY: Readonly<Record<string, AgentAdapter>> = {
  'claude-anthropic': claudeAnthropicAdapter,
};

/**
 * Returns every adapter currently shipped in the host and SDK registries.
 *
 * This keeps parity checks coupled to the actual selectable surface: adding
 * an adapter to either registry automatically brings it into the shared
 * contract tests without treating roadmap placeholders as live transports.
 */
export function registeredAdapters(): readonly AgentAdapter[] {
  return [...Object.values(HOST_REGISTRY), ...Object.values(SDK_REGISTRY)];
}

interface ResolvedSelection {
  readonly mode: AdapterMode;
  readonly name: string;
}

/**
 * Resolves which adapter to use given the current environment +
 * config + auto-detection rules.
 *
 * @param cwd - Project root used to find `.cladding/config.yaml`.
 *     Defaults to the current working directory.
 * @returns The {@link AgentAdapter} the drive loop should dispatch
 *     to. Always returns an adapter — if nothing matches the
 *     registry the host fallback (`generic-mcp`) is used.
 */
export function selectAdapter(cwd: string = '.'): AgentAdapter {
  const choice = resolveSelection(cwd);
  if (choice.mode === 'host') {
    const adapter = HOST_REGISTRY[choice.name];
    if (adapter) return adapter;
  } else if (choice.mode === 'sdk') {
    const adapter = SDK_REGISTRY[choice.name];
    if (adapter) return adapter;
  }
  // Unknown mode / name combination — fall through to generic-mcp so
  // dispatch never crashes; drive loop's healthCheck() reports the
  // mismatch via `LLM_UNAVAILABLE` (F-049 AC-088).
  return genericMcpAdapter;
}

/**
 * Lower-level helper exposed for tests. Walks the resolution order
 * and returns the chosen `{mode, name}` without instantiating an
 * adapter.
 */
export function resolveSelection(cwd: string = '.'): ResolvedSelection {
  const envMode = process.env.CLADDING_AGENT_MODE;
  const envName = process.env.CLADDING_AGENT_NAME;
  if (envMode && envName) {
    return {mode: envMode as AdapterMode, name: envName};
  }

  const fileSelection = readConfigSelection(cwd);
  if (fileSelection) return fileSelection;

  return {mode: 'host', name: autoDetectHost()};
}

/**
 * Reads `.cladding/config.yaml` if present and pulls out the
 * `agent.mode` + `agent.name` keys. Returns null when the file is
 * absent or the keys are missing — the caller falls through to
 * auto-detect.
 */
function readConfigSelection(cwd: string): ResolvedSelection | null {
  const configPath = join(cwd, '.cladding', 'config.yaml');
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = parseYaml(raw) as {agent?: {mode?: AdapterMode; name?: string}} | null;
    const agent = parsed?.agent;
    if (!agent || !agent.mode || !agent.name) return null;
    return {mode: agent.mode, name: agent.name};
  } catch {
    return null;
  }
}

/**
 * Returns the host adapter name that fits the current runtime when
 * no explicit configuration is supplied.
 *
 * Today the only auto-detected host is Claude Code; everything else
 * falls back to the generic MCP adapter, which targets any host
 * that speaks the Model Context Protocol.
 */
function autoDetectHost(): string {
  if (isClaudeCodeRuntime()) return 'claude-code';
  return 'generic-mcp';
}
