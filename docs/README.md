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
| [`design/spec-0.2.md`](design/spec-0.2.md) + `design/spec-0.2/` | **B/C** | accepted target-design router plus bounded canonical owners for model/migration, proof/editing, delivery, hygiene, GraphIR, context/orchestration, assurance, MCP, split evidence, executable validation guide, and decision history *(implementation pending)* | amend one owner + central `decision-log.md` change log; reproduce projections with `npm run validate:spec-0.2` | maintainers and fresh sessions; read the router and only the owner files routed for the current task |
| [`design/ironclad-obligation-rfc.md`](design/ironclad-obligation-rfc.md) | **B** | non-authoritative, unsubmitted draft proposal derived from Spec 0.2 D21–D23 | manual; never treated as accepted Ironclad policy | maintainers preparing a later upstream discussion |
| `spec-ids-multi-dev.md` | **B** | design SSoT — hash-based ID conventions (v0.3.9+) | manual | planner persona + every spec author |
| `ux-routing-coverage.md` | **B** | design SSoT — Soft Shell coverage status | manual | reviewer + roadmap planners |
| `glossary.md` | **C** | terminology SSoT — public-name definitions | manual | contributors + `self-consistency.test.ts` |
| `feature-cycle.md` | **B** | design SSoT — one feature's spec→code→test→done lifecycle | manual | orchestrator + planner + developer personas |
| `gate-scope.md` | **B** | design SSoT — module-scoped gate for monorepos | manual | reviewer + monorepo adopters |
| `ssot-testing.md` | **B** | governance policy — SSoT lifecycle test strategy | manual | reviewer + test-author developer |
| `knowledge-graph/design.md` | **B** | historical SSoT — shipped v1 graph model, cost record, and post-ship departures; superseded target is `design/spec-0.2/graph.md` D17 | manual historical amendment | maintainers auditing v1 or migrating graph consumers |
| `benchmarks/` | **D** audit (post-hoc reports) | append-only per benchmark run; a superseded run-log may be compressed to a dated abstract + git-history pointer once no live claim cites its numbers | manual benchmark commits | maintainers reviewing performance regressions |
| `dogfood/` | **D** audit (post-hoc reports) | append-only per dogfood session | manual dogfood commits | maintainers reviewing harness behaviour on real adoption |

## Why mixed tiers in one directory

`docs/` encodes **domain** (human-readable documentation), not tier. A reader who lands here is looking for prose explanations; the tier is metadata they consult when they need to know "can I edit this file?" or "what regenerates it?". The first-line header banner answers both in one line.

The alternative — tier-named directories (`tier-b/`, `tier-c/`) — was rejected: it would require ~1500 LOC of detector path rewrites, break upstream Ironclad standard compatibility, and obscure the more useful "this is documentation prose" semantic. See `ssot-model.md` §Directory policy for the full reasoning.

## See also

- [`ssot-model.md`](./ssot-model.md) — the 4-tier governance policy this README indexes
- [`design/spec-0.2.md`](./design/spec-0.2.md) — accepted 0.10.0 task router; it links the one canonical owner for each decision *(not current runtime behavior)*
- [`../spec/README.md`](../spec/README.md) — Tier A + B (structured spec data) directory index
- [`../src/agents/README.md`](../src/agents/README.md) — persona role table + how each persona reads which tier
