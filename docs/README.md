<!-- Cladding · Tier C · directory index · Refreshed by: manual -->

# docs/

Human-readable documentation for cladding. Mixed-tier: design SSoT (Tier B) lives next to derived/observable docs (Tier C). The tier is encoded in each file's first-line header banner — see [`ssot-model.md`](./ssot-model.md) for the full governance policy.

## Tier index

| File | Tier | Authority | Refresh trigger | Consumer |
|---|---|---|---|---|
| `ssot-model.md` | **B** | governance policy (this directory's index) | manual | every persona/skill references it instead of repeating policy |
| `project-context.md` (in adopting projects) | **B** | SSoT — intent + Why/What/Purpose | `clad init` / `clad clarify` (LLM-refined) | AI personas (orchestrator/developer) + scenario generator + human onboarding readers |
| `conventions.md` (in adopting projects) | **C** | derived from observed code OR greenfield seed | `clad init --scan` | `developer` persona when writing code + human reviewers |
| `code-style.md` | **C** | hand-authored, legacy (cladding-self only) | manual | cladding contributors (legacy reference; will deprecate in favour of conventions.md) |
| `multi-provider-roadmap.md` | **B** | design SSoT — host vs SDK adapter model | manual | maintainers + adopters routing through multi-host adapters |
| `spec-ids-multi-dev.md` | **B** | design SSoT — hash-based ID conventions (v0.3.9+) | manual | planner persona + every spec author |
| `ux-routing-coverage.md` | **B** | design SSoT — Soft Shell coverage status | manual | reviewer + roadmap planners |
| `glossary.md` | **C** | terminology SSoT — public-name definitions | manual | contributors + `self-consistency.test.ts` |
| `feature-cycle.md` | **B** | design SSoT — one feature's spec→code→test→done lifecycle | manual | orchestrator + planner + developer personas |
| `gate-scope.md` | **B** | design SSoT — module-scoped gate for monorepos | manual | reviewer + monorepo adopters |
| `ssot-testing.md` | **B** | governance policy — SSoT lifecycle test strategy | manual | reviewer + test-author developer |
| `knowledge-graph/design.md` | **B** | design SSoT — knowledge-graph model & cost | manual | maintainers + graph contributors |
| `benchmarks/` | **D** audit (post-hoc reports) | append-only per benchmark run | manual benchmark commits | maintainers reviewing performance regressions |
| `dogfood/` | **D** audit (post-hoc reports) | append-only per dogfood session | manual dogfood commits | maintainers reviewing harness behaviour on real adoption |
| `ssot-audit.md` | **D** audit (post-hoc report) | v0.4.x SSoT document-system audit (2026-05-31) | manual audit commit | maintainers reviewing SSoT integrity |
| `marketplace-self-contained.md` | **D** audit (shipped design note) | self-contained marketplace plugin — decisions & status | manual | maintainers + host-integration work |

## Why mixed tiers in one directory

`docs/` encodes **domain** (human-readable documentation), not tier. A reader who lands here is looking for prose explanations; the tier is metadata they consult when they need to know "can I edit this file?" or "what regenerates it?". The first-line header banner answers both in one line.

The alternative — tier-named directories (`tier-b/`, `tier-c/`) — was rejected: it would require ~1500 LOC of detector path rewrites, break upstream Ironclad standard compatibility, and obscure the more useful "this is documentation prose" semantic. See `ssot-model.md` §Directory policy for the full reasoning.

## See also

- [`ssot-model.md`](./ssot-model.md) — the 4-tier governance policy this README indexes
- [`../spec/README.md`](../spec/README.md) — Tier A + B (structured spec data) directory index
- [`../src/agents/README.md`](../src/agents/README.md) — persona role table + how each persona reads which tier
