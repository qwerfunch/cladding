<!-- Cladding · Tier C · directory index · Refreshed by: manual -->

# docs/

Human-readable documentation for cladding. Mixed-tier: design SSoT (Tier B) lives next to derived/observable docs (Tier C). The tier is encoded in each file's first-line header banner — see [`ssot-model.md`](./ssot-model.md) for the full governance policy.

## Tier index

| File | Tier | Authority | Refresh trigger | Consumer |
|---|---|---|---|---|
| `ssot-model.md` | **B** | governance policy (this directory's index) | manual | every persona/skill references it instead of repeating policy |
| `project-context.md` (in adopting projects) | **B** | SSoT — intent + Why/What/Purpose | `clad init` / `clad refine` (LLM-refined) | AI personas (orchestrator/specialists) + scenario generator + human onboarding readers |
| `conventions.md` (in adopting projects) | **C** | derived from observed code OR greenfield seed | `clad init --scan` | `specialists` persona when writing code + human reviewers |
| `code-style.md` | **C** | hand-authored, legacy (cladding-self only) | manual | cladding contributors (legacy reference; will deprecate in favour of conventions.md) |
| `multi-provider-roadmap.md` | **B** | design SSoT — host vs SDK adapter model | manual | maintainers + adopters routing through multi-host adapters |
| `spec-ids-multi-dev.md` | **B** | design SSoT — hash-based ID conventions (v0.3.9+) | manual | librarian persona + every spec author |
| `ux-routing-coverage.md` | **B** | design SSoT — Soft Shell coverage status | manual | reviewer + roadmap planners |
| `benchmarks/` | **D** audit (post-hoc reports) | append-only per benchmark run | manual benchmark commits | maintainers reviewing performance regressions |
| `dogfood/` | **D** audit (post-hoc reports) | append-only per dogfood session | manual dogfood commits | maintainers reviewing harness behaviour on real adoption |

## Why mixed tiers in one directory

`docs/` encodes **domain** (human-readable documentation), not tier. A reader who lands here is looking for prose explanations; the tier is metadata they consult when they need to know "can I edit this file?" or "what regenerates it?". The first-line header banner answers both in one line.

The alternative — tier-named directories (`tier-b/`, `tier-c/`) — was rejected: it would require ~1500 LOC of detector path rewrites, break upstream Ironclad standard compatibility, and obscure the more useful "this is documentation prose" semantic. See `ssot-model.md` §Directory policy for the full reasoning.

## See also

- [`ssot-model.md`](./ssot-model.md) — the 4-tier governance policy this README indexes
- [`../spec/README.md`](../spec/README.md) — Tier A + B (structured spec data) directory index
- [`../src/agents/README.md`](../src/agents/README.md) — persona role table + how each persona reads which tier
