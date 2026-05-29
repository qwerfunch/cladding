<!-- Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad refine -->

# Cladding — Project Context

## 1. Why does this project exist?

AI-assisted development produces code fast but loses coherence as projects grow. Spec drifts from code; architecture invariants exist only in the maintainer's head; multi-developer collaboration becomes a race condition. **Cladding is the reference implementation of the Ironclad standard for AI-coupled software** — a harness that turns "drift detection" from a vague aspiration into a concrete set of detectors that fail CI when reality and intent diverge.

## 2. What problem does it solve?

Specifically, cladding closes three gaps in AI-coupled development:

- **Spec ↔ code traceability**: Every feature has an id, modules, ACs, and a status. Every source file maps to a feature (or trips `UNMAPPED_ARTIFACT`).
- **Architecture invariants**: `spec/architecture.yaml` declares layers + forbidden imports; `ARCHITECTURE_FROM_SPEC` enforces them.
- **Multi-developer safety**: Hash-based feature ids (`F-<hash6>`) prevent collisions when multiple developers concurrently invoke `clad_create_feature`.

The 4-tier SSoT model (Tier A spec sealed → Tier B design editable → Tier C derived → Tier D audit/transient) gives every artifact an explicit refresh authority. Cladding's own scaffold is itself measured (via the A/B evaluation framework, F-4db939 + F-ba2e05) against vanilla Claude Code on the same intent.

## 3. What is its purpose?

To make AI-coupled development **measurably safer and more honest** than vanilla AI coding. Honest = drift becomes visible; measurable = 27 detectors fire actionable findings; safer = the Iron Law gates fail CI when artifacts diverge from code reality.

## Related governance documents

- [`docs/ssot-model.md`](./ssot-model.md) — 4-tier SSoT policy (refresh authorities, header convention)
- [`docs/ssot-testing.md`](./ssot-testing.md) — Lifecycle testing methodology
- [`docs/ab-evaluation/README.md`](./ab-evaluation/README.md) — A/B evaluation methodology
- [`spec/architecture.yaml`](../spec/architecture.yaml) — Architecture invariants
- [`spec/capabilities.yaml`](../spec/capabilities.yaml) — Capability ↔ feature traceability
