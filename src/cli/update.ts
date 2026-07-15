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

import {type AgentsMdResult} from '../init/host-instructions.js';
import {type SpecAgentsMdResult, writeSpecDrivenAgentsMd} from '../init/agents-md.js';
import {computeInventory, writeInventoryToSpecYaml, writeFeatureIndex} from '../spec/inventory.js';
import {gitOperationInProgress} from '../core/git-ops.js';

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
  /** Spec-driven AGENTS.md outcome (mapped onto AgentsMdResult), or `'n/a'` when not a project. */
  readonly agentsMd: AgentsMdResult | 'n/a';
  /** Feature count from the freshly-recomputed inventory. */
  readonly features: number;
  /** Process exit code: nonzero only on host-wiring failure (drift never blocks). */
  readonly code: number;
  /** Report-only deprecation notices (F-b43066) — dead spec knobs draining out. */
  readonly deprecations: readonly string[];
  /** True when a git operation was in progress, so the inventory + index writes
   * were skipped (the caller reports the deferral instead of "synced"). */
  readonly inventoryDeferred?: boolean;
}

/**
 * Projects the spec-driven writer's outcome onto the legacy `AgentsMdResult`
 * the update report already speaks. A regenerated-but-identical block and a
 * hand-authored (markerless) file both read as a benign 'skipped-exists'; an
 * actual block rewrite reads as 'refreshed-stale'.
 */
function mapAgentsMdResult(r: SpecAgentsMdResult): AgentsMdResult {
  switch (r) {
    case 'created':
      return 'created';
    case 'updated':
      return 'refreshed-stale';
    default: // 'unchanged' | 'skipped-unmanaged'
      return 'skipped-exists';
  }
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
      agentsMd: 'n/a',
      features: 0,
      code: wiringErrors > 0 ? 1 : 0,
      deprecations: [],
    };
  }

  // 2. Reconcile the spec.yaml inventory snapshot (deterministic). Skip the
  //    writes (keep the read-only count for the report) while a git operation
  //    is in progress, so a merge/rebase sees no surprise derived-file edits.
  const inv = computeInventory(cwd);
  const inventoryDeferred = gitOperationInProgress(cwd);
  if (!inventoryDeferred) {
    writeInventoryToSpecYaml(cwd, inv);
    writeFeatureIndex(cwd); // F-37b4a8
  }

  // 3. Refresh the cladding-managed AGENTS.md section — staleness-based only;
  //    user prose preserved, no `--force`, no LLM dispatch. AGENTS.md
  //    is now the spec-driven managed block (F-a4085adf, #199): a marker-upsert
  //    that regenerates only the delimited block, is byte-stable on unchanged
  //    spec, and leaves a markerless (hand-authored) file untouched. Its richer
  //    outcome is mapped onto the existing AgentsMdResult contract the update
  //    report speaks: a byte-stable / hand-authored no-op reads as 'skipped-exists'.
  const agentsMd = mapAgentsMdResult(writeSpecDrivenAgentsMd(cwd));

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
    agentsMd,
    features: inv.features ?? 0,
    code: wiringErrors > 0 ? 1 : 0,
    deprecations,
    inventoryDeferred,
  };
}
