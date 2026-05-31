// Cladding · scenarios · size-budgets (v0.3.46, F-4747ef)
//
// Token / size budgets for every cladding-managed artifact + persona +
// LLM prompt. Lifecycle tests assert measurements stay within budget
// so PR-level regressions (e.g., persona prompt grew 30% during a doc
// rewrite, LLM onboarding prompt added a verbose new sentinel block,
// generated capabilities.yaml bloated to 200 lines) fail the gate
// rather than silently shipping.
//
// Baseline calibration (2026-05-21, post-PR-131):
//   wc -l/-c on each tracked file → set budget at +20-25% headroom.
//   The headroom absorbs reasonable growth (one new persona principle,
//   one extra capability entry) without forcing budget bumps.
//
// When a legitimate growth crosses a budget:
//   1. Bump the budget HERE first (PR review enforces this is a
//      considered change, not silent drift).
//   2. Then merge the artifact change.
//
// This ratchet pattern is the same mechanism cladding uses for the
// plugin manifest detector count (auto-recounted by build:plugin;
// committed value is the source of truth).

import {type SizeMeasurement} from './_token-meter.js';

/** Per-target budget: hard caps on lines + chars. Tokens are derived. */
export interface SizeBudget {
  readonly maxLines: number;
  readonly maxChars: number;
  /** Derived max token estimate (computed as `maxChars / 4`). */
  readonly maxTokens: number;
}

function budget(maxLines: number, maxChars: number): SizeBudget {
  return {maxLines, maxChars, maxTokens: Math.round(maxChars / 4)};
}

/** Persona system-prompt budgets (canonical sources under `src/agents/`). */
export const PERSONA_BUDGETS = {
  'src/agents/orchestrator.md': budget(107, 8000),  // baseline 96/7153 — v0.4.x reshaped recipe→feature-cycle + mode gloss (F-3b3690)
  'src/agents/librarian.md': budget(75, 4500),       // baseline 68/4149 — v0.3.59 added Project policy section (F-0ed2db)
  'src/agents/specialists.md': budget(80, 4600),     // baseline 76/4246 — v0.5.x honest anti-self-cert: advisory blindness vs enforced identity layer + interface-stub (F-3b3690)
  'src/agents/reviewer.md': budget(85, 4900),        // baseline 81/4533 — v0.5.x reviewer owns the advisory blindness audit no gate enforces (F-3b3690)
  'src/agents/observability.md': budget(60, 3500),   // baseline 50/3115 — v0.3.59 added Project policy section (F-0ed2db)
} as const;

/** Meta documents that all personas reference (loaded once per session). */
export const META_DOC_BUDGETS = {
  'docs/ssot-model.md': budget(250, 16500),          // baseline 194/13676 (single policy doc)
} as const;

/** LLM dispatcher prompt budgets (built in-memory). */
export const LLM_PROMPT_BUDGETS = {
  /** `buildOnboardingPrompt(intent, observed)` — 7 sentinels + question rules. */
  onboardingMaxTokens: 3500,
  /** `buildRefinementPrompt(intent, observed, qaHistory, current)` — base prompt. */
  refinementBaseMaxTokens: 3000,
  /**
   * Per-Q-A pair token allowance — refinement prompt is allowed to
   * grow LINEARLY with Q-A history. Anything super-linear is a
   * regression (e.g., serializing the same artifact body twice).
   */
  refinementPerQaPairMaxTokens: 200,
  /** Per kilobyte of current-artifact body embedded in the refinement prompt. */
  refinementPerCurrentBodyKbMaxTokens: 280,
} as const;

/**
 * Generated-artifact budgets for the bodies cladding emits on
 * `clad init` / `clad init --scan` / `clad refine`. These are the
 * "first run after onboarding" sizes; values track the size after
 * a typical 2-3 refine iterations, so they bake in expected growth.
 */
export const ARTIFACT_BUDGETS = {
  'docs/project-context.md': budget(220, 9000),
  'spec/capabilities.yaml': budget(120, 5000),
  'spec/architecture.yaml': budget(90, 3500),
  'docs/conventions.md': budget(160, 6500),
  /** Per single scenario shard (`spec/scenarios/<slug>-<hash6>.yaml`). */
  'spec/scenarios/*.yaml': budget(50, 2000),
  /** Onboarding state.yaml (D-tier, transient). Grows linearly with Q-A history. */
  '.cladding/onboarding/state.yaml': budget(100, 4000),
} as const;

/** Returns the budget value for a generated artifact path (literal lookup). */
export type ArtifactPath = keyof typeof ARTIFACT_BUDGETS;

/** Assertion result for the `assertSizeWithinBudget` helper. */
export interface BudgetCheckResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

/**
 * Pure budget check — returns the result instead of throwing so
 * lifecycle tests can collect all violations across a stage before
 * deciding whether to fail. Pair with `expect(result.ok).toBe(true)`
 * in the test to convert to vitest failure.
 */
export function checkBudget(
  label: string,
  measurement: SizeMeasurement,
  bud: SizeBudget,
): BudgetCheckResult {
  const violations: string[] = [];
  if (measurement.lines > bud.maxLines) {
    violations.push(
      `${label}: ${measurement.lines} lines > budget ${bud.maxLines} (overage: ${measurement.lines - bud.maxLines})`,
    );
  }
  if (measurement.chars > bud.maxChars) {
    violations.push(
      `${label}: ${measurement.chars} chars > budget ${bud.maxChars} (overage: ${measurement.chars - bud.maxChars})`,
    );
  }
  return {ok: violations.length === 0, violations};
}

/**
 * Computes the refinement prompt budget for a given Q-A history length
 * and current-body size. Used by lifecycle tests at stages where
 * `clad refine` runs after multiple turns.
 */
export function refinementPromptBudget(qaPairs: number, currentBodyChars: number): SizeBudget {
  const baseTokens = LLM_PROMPT_BUDGETS.refinementBaseMaxTokens;
  const qaTokens = LLM_PROMPT_BUDGETS.refinementPerQaPairMaxTokens * qaPairs;
  const bodyTokens = Math.round((currentBodyChars / 1024) * LLM_PROMPT_BUDGETS.refinementPerCurrentBodyKbMaxTokens);
  const maxTokens = baseTokens + qaTokens + bodyTokens;
  return {maxLines: Number.POSITIVE_INFINITY, maxChars: maxTokens * 4, maxTokens};
}

/**
 * Convenience: returns the budget for `buildOnboardingPrompt`. The
 * onboarding prompt is roughly fixed-size; only one knob (maxTokens).
 */
export function onboardingPromptBudget(): SizeBudget {
  const maxTokens = LLM_PROMPT_BUDGETS.onboardingMaxTokens;
  return {maxLines: Number.POSITIVE_INFINITY, maxChars: maxTokens * 4, maxTokens};
}

/** Re-export for downstream consumers. */
export {measureText} from './_token-meter.js';
