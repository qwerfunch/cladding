// Cladding · agents · host detection (0.4.10 PR-A.2)
//
// Reads process.env to identify which AI host cladding is running
// inside. Used by:
//   - the detect_host MCP tool (src/serve/server.ts) — exposes the
//     detection result to host AIs that need to branch on it.
//   - the dispatchHint shaper in PR-A.3 — only Tier 1 hosts receive
//     a sub-agent dispatch hint; Tier 3 stays on host-self-inject.
//
// Tier mapping reflects the 0.4.10 plan's 4-host multi-agent reality:
//   Tier 1: Claude Code · Codex · Cursor · Antigravity (full native
//           sub-agent dispatch + isolated context + tool restriction).
//   Tier 2: Gemini CLI (sub-agent preview, sunsetting June 18 2026 →
//           Antigravity migration).
//   Tier 3: generic / unknown (multi-persona fallback — option-1
//           dispatch via personaPrompt self-inject).
//
// Manual override: CLADDING_HOST=<name> bypasses env signals. Useful
// for users running cladding inside a wrapper that sets a host's
// signature env vars for unrelated reasons.

export type HostName =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'antigravity'
  | 'generic';

export type HostTier = 1 | 2 | 3;

export interface HostDetection {
  readonly host: HostName;
  readonly tier: HostTier;
  /** Env vars that triggered the detection (debug surface). */
  readonly signals: readonly string[];
  /** True when CLADDING_HOST env override was used. */
  readonly overridden: boolean;
}

const VALID_HOST_OVERRIDES: ReadonlySet<HostName> = new Set<HostName>([
  'claude-code',
  'codex',
  'cursor',
  'gemini',
  'antigravity',
  'generic',
]);

const TIER_MAP: Readonly<Record<HostName, HostTier>> = {
  'claude-code': 1,
  codex: 1,
  cursor: 1,
  antigravity: 1,
  gemini: 2,
  generic: 3,
};

/**
 * Identifies the active host from process.env signals. Manual
 * override via `CLADDING_HOST` takes precedence over env detection.
 *
 * Detection priority (first match wins):
 *   1. CLADDING_HOST=<valid-host-name>
 *   2. ANTIGRAVITY_HOME / ANTIGRAVITY_SESSION → antigravity (Tier 1)
 *   3. CLAUDECODE=1 → claude-code (Tier 1)
 *   4. CODEX_HOME / CODEX_CONFIG / CODEX_BUILD → codex (Tier 1)
 *   5. CURSOR_SESSION / CURSOR_TRACE / TERM_PROGRAM=cursor → cursor (Tier 1)
 *   6. GEMINI_HOME / GEMINI_CLI → gemini (Tier 2)
 *   7. (none) → generic (Tier 3)
 */
export function detectHost(env: NodeJS.ProcessEnv = process.env): HostDetection {
  const override = (env.CLADDING_HOST ?? '').trim().toLowerCase() as HostName;
  if (override && VALID_HOST_OVERRIDES.has(override)) {
    return {host: override, tier: TIER_MAP[override], signals: ['CLADDING_HOST'], overridden: true};
  }

  // Antigravity check before claude-code/codex because some users may
  // run cladding inside Antigravity with legacy env vars still set.
  const antigravitySignals = pickSignals(env, ['ANTIGRAVITY_HOME', 'ANTIGRAVITY_SESSION']);
  if (antigravitySignals.length > 0) {
    return {host: 'antigravity', tier: 1, signals: antigravitySignals, overridden: false};
  }

  if (env.CLAUDECODE === '1' || env.CLAUDECODE === 'true') {
    return {host: 'claude-code', tier: 1, signals: ['CLAUDECODE'], overridden: false};
  }

  const codexSignals = pickSignals(env, ['CODEX_HOME', 'CODEX_CONFIG', 'CODEX_BUILD']);
  if (codexSignals.length > 0) {
    return {host: 'codex', tier: 1, signals: codexSignals, overridden: false};
  }

  const cursorSignals = pickSignals(env, ['CURSOR_SESSION', 'CURSOR_TRACE']);
  if (cursorSignals.length > 0 || env.TERM_PROGRAM === 'cursor') {
    const signals = [...cursorSignals];
    if (env.TERM_PROGRAM === 'cursor') signals.push('TERM_PROGRAM=cursor');
    return {host: 'cursor', tier: 1, signals, overridden: false};
  }

  const geminiSignals = pickSignals(env, ['GEMINI_HOME', 'GEMINI_CLI']);
  if (geminiSignals.length > 0) {
    return {host: 'gemini', tier: 2, signals: geminiSignals, overridden: false};
  }

  return {host: 'generic', tier: 3, signals: [], overridden: false};
}

function pickSignals(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((k) => {
    const v = env[k];
    return typeof v === 'string' && v.length > 0;
  });
}
