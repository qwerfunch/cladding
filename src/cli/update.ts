// Cladding · `clad update` — post-upgrade project reconciliation.
//
// WHY this exists: an npm / marketplace upgrade replaces the ENGINE — the global
// `clad` binary plus its detectors, schema, and personas. Those reach the user
// the moment they upgrade (the binary is read live; the host wiring is a symlink
// that follows it). But three things do NOT auto-follow an upgrade:
//   1. host wiring — a symlink can need re-pointing, or a new version adds a
//      channel/skill the old `clad setup` never wired;
//   2. the spec.yaml `inventory:` snapshot — a frozen count of project scale;
//   3. the cladding-managed CLAUDE.md / AGENTS.md section — host guidance the AI
//      reads each session, materialized into the user's repo at init time.
// Re-running `clad setup` + `clad sync` + `clad init` by hand is the documented
// routine; this folds the SAFE parts into one idempotent command so an upgrade
// is two lines: `npm update -g cladding`, then `clad update`.
//
// DESIGN — safe-auto, data-report (the same split the whole update model uses):
//   * Mechanical, idempotent steps (re-wire, inventory, managed-section refresh)
//     run automatically. The managed-section refresh is staleness-based (never
//     `--force`, never an LLM call — see host-instructions.ts), so a user's own
//     prose is preserved and a fresh section is left untouched.
//   * The user's OWN data — their spec — is never auto-edited here. `clad update`
//     does NOT run the gate as a gate; the caller (runUpdateCommand) runs the
//     now-stricter detectors in REPORT mode so the command SHOWS what bar the
//     upgrade raised (it can't hide that — anti-Vacuous-Green) without blocking
//     or rewriting the spec. Reconciling findings stays the user's call.
//   * Idempotent: a second run with nothing stale is a clean no-op.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import {
  type AgentsMdResult,
  type ClaudeMdResult,
  writeAgentsMd,
  writeClaudeMdSection,
} from '../init/host-instructions.js';
import {computeInventory, writeInventoryToSpecYaml, writeFeatureIndex} from '../spec/inventory.js';

/**
 * Injected so `runUpdate` is unit-testable without touching the global home
 * dir. The drift REPORT is deliberately NOT here — it is report-only and lives
 * in the command wrapper, so `runUpdate` only ever does safe mutations.
 */
export interface UpdateDeps {
  /** Re-wire host channels (wraps `runHostSetup`); resolves to the wiring-error count. */
  readonly wireHosts: () => Promise<number>;
}

export interface UpdateResult {
  /** False when `cwd` has no spec.yaml — only the global re-wire ran. */
  readonly isProject: boolean;
  /** Count of host channels that failed to wire (0 = clean). */
  readonly wiringErrors: number;
  /** `writeClaudeMdSection` outcome, or `'n/a'` when not a project. */
  readonly claudeMd: ClaudeMdResult | 'n/a';
  /** `writeAgentsMd` outcome, or `'n/a'` when not a project. */
  readonly agentsMd: AgentsMdResult | 'n/a';
  /** Feature count from the freshly-recomputed inventory. */
  readonly features: number;
  /** Process exit code: nonzero only on host-wiring failure (drift never blocks). */
  readonly code: number;
  /** Report-only deprecation notices (F-b43066) — dead spec knobs draining out. */
  readonly deprecations: readonly string[];
}

/**
 * Runs the safe, idempotent half of a post-upgrade reconciliation: re-wire host
 * channels, refresh the spec.yaml inventory snapshot, and refresh the
 * cladding-managed CLAUDE.md / AGENTS.md section (staleness-based, prose-
 * preserving). All file IO is under `cwd` plus the injected `wireHosts`, so this
 * is unit-testable without the real toolchain or the user's home directory. The
 * stricter-detector REPORT is the caller's job (report-only, never blocks).
 */
export async function runUpdate(cwd: string, deps: UpdateDeps): Promise<UpdateResult> {
  // 1. Re-wire hosts (global, idempotent) — useful even outside a project.
  const wiringErrors = await deps.wireHosts();

  if (!existsSync(join(cwd, 'spec.yaml'))) {
    return {
      isProject: false,
      wiringErrors,
      claudeMd: 'n/a',
      agentsMd: 'n/a',
      features: 0,
      code: wiringErrors > 0 ? 1 : 0,
      deprecations: [],
    };
  }

  // 2. Reconcile the spec.yaml inventory snapshot (deterministic).
  const inv = computeInventory(cwd);
  writeInventoryToSpecYaml(cwd, inv);
  writeFeatureIndex(cwd); // F-37b4a8

  // 3. Refresh the cladding-managed CLAUDE.md / AGENTS.md section — staleness-
  //    based only; user prose preserved, no `--force`, no LLM dispatch.
  const claudeMd = writeClaudeMdSection(cwd);
  const agentsMd = writeAgentsMd(cwd);

  // 4. Deprecation sweep (report-only, F-b43066): dead spec knobs that the
  //    schema still accepts but 0.7 removes — surfaced here, never blocking.
  const deprecations: string[] = [];
  // F-16746b — CI is the authoritative gate; surface its absence (report-only).
  if (!existsSync(join(cwd, '.github', 'workflows'))) {
    deprecations.push(
      'no CI workflow found — client hooks are per-dev bypassable; scaffold the authoritative gate with `clad init --with-ci`.',
    );
  }
  try {
    const raw = readFileSync(join(cwd, 'spec.yaml'), 'utf8');
    if (/^\s*token_budget_per_session:/m.test(raw)) {
      deprecations.push(
        'ai_hints.token_budget_per_session is deprecated (it never had a runtime consumer) — remove the line; the schema stops accepting it in 0.7.',
      );
    }
  } catch {
    /* report-only */
  }

  return {
    isProject: true,
    wiringErrors,
    claudeMd,
    agentsMd,
    features: inv.features ?? 0,
    code: wiringErrors > 0 ? 1 : 0,
    deprecations,
  };
}
