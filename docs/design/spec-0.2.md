<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — continuation router

## Status

| Field | Value |
|---|---|
| Target release | Cladding 0.10.0 |
| Target schema | `"0.2"` |
| Current shipped schema | `"0.1"` |
| Design status | Accepted; implementation pending |
| Last design review | 2026-08-29 |
| Authority | Navigation SSoT for the accepted target-design set; normative decisions live in the linked owner documents |

The current runtime remains governed by [`docs/ssot-model.md`](../ssot-model.md), [`spec/README.md`](../../spec/README.md), and source code until each target-design part lands.

## Continuation contract

For a fresh planning or implementation session:

1. Read [`AGENTS.md`](../../AGENTS.md), this router, and only the task-routed owner documents.
2. Load [Evidence snapshot](spec-0.2/evidence.md#evidence-snapshot) or [Assurance evidence](spec-0.2/assurance-evidence.md) only to reproduce a measurement or evaluate a claim.
3. Keep accepted target decisions separate from shipped runtime behavior.
4. Change only the canonical owner, append its [Change log](spec-0.2/decision-log.md#change-log) row, and preserve displaced alternatives as rejected history.
5. Label numbers as **verified measurement**, **acceptance target**, or **projection**. Never promote a projection without a reproducible artifact.

Old chat transcripts are not authority. This router intentionally contains no duplicate normative contract.

## Task routing

| Work | Read |
|---|---|
| F1 compiler/registry bootstrap | D10 in [Model and migration](spec-0.2/model-and-migration.md), D17 in [GraphIR](spec-0.2/graph.md), and D15/D16 in [Delivery](spec-0.2/delivery.md) |
| F2 parsing or F3 catalog/rules | [Model and migration](spec-0.2/model-and-migration.md), the relevant D17 subsection, and D15/D16 |
| Schema migration or generated relocation | D03/D14 in [Model and migration](spec-0.2/model-and-migration.md), D12 in [Proof and editing](spec-0.2/proof-and-editing.md), and D15/D16 |
| F4 transactional editing and cycle begin | [Proof and editing](spec-0.2/proof-and-editing.md) and D15/D16 in [Delivery](spec-0.2/delivery.md) |
| F5 bindings/evidence or F6 assurance/attestation | [Proof and editing](spec-0.2/proof-and-editing.md), [Assurance](spec-0.2/assurance.md), D17 closures, and D15/D16 |
| F7 scenarios | D09 in [Model and migration](spec-0.2/model-and-migration.md#d09--scenario-contract), D15/D16, and D17 |
| F8 GraphIR cutover, graph query/export/viewer | [GraphIR and bounded retrieval](spec-0.2/graph.md) and D15/D16 |
| F9 task projection, context measurement, background scheduler, or orchestration A/B | [Context and orchestration](spec-0.2/context-and-orchestration.md), [Assurance](spec-0.2/assurance.md), and D15/D16 |
| Iron Law theory, stage/profile policy, incremental verification, or upstream RFC | [Assurance](spec-0.2/assurance.md), then D15/D16 and [Assurance evidence](spec-0.2/assurance-evidence.md) only when reproducing cadence measurements |
| F10 headless task-state loop or F11 generated relocation | [Context and orchestration](spec-0.2/context-and-orchestration.md) or D03/D14 in [Model and migration](spec-0.2/model-and-migration.md), plus D15/D16 |
| MCP adapter, host compatibility, or catalog/token validation | [MCP boundary](spec-0.2/mcp.md), D15/D16, and the [Validation protocol](spec-0.2/validation.md) |
| Implementation hygiene, code/doc/test retirement | D18 in [Implementation hygiene](spec-0.2/hygiene.md#d18--implementation-hygiene-and-documentation-surface) |
| Claims, alternatives, later work, history | [Decision log](spec-0.2/decision-log.md) |
| Measurement reproduction only | [Evidence snapshot](spec-0.2/evidence.md); use [Assurance evidence](spec-0.2/assurance-evidence.md) for cadence, invalidation, and A/B/C policy measurements |

## Decision map

Each heading below preserves the former monolithic-document anchor and routes to its one canonical owner.

## D01 — Objective and guarantee boundary

Owner: [D01](spec-0.2/model-and-migration.md#d01--objective-and-guarantee-boundary).

## D02 — WHY / WHAT / HOW model and terminology

Owner: [D02](spec-0.2/model-and-migration.md#d02--why--what--how-model-and-terminology).

## D03 — Artifact layout and necessity

Owner: [D03](spec-0.2/model-and-migration.md#d03--artifact-layout-and-necessity).

## D04 — Identity and sharding

Owner: [D04](spec-0.2/model-and-migration.md#d04--identity-and-sharding).

## D05 — Project contract

Owner: [D05](spec-0.2/model-and-migration.md#d05--project-contract).

## D06 — Feature and criterion contract

Owner: [D06](spec-0.2/model-and-migration.md#d06--feature-and-criterion-contract).

## D07 — Capability contract and edge ownership

Owner: [D07](spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership).

## D08 — Architecture contract

Owner: [D08](spec-0.2/model-and-migration.md#d08--architecture-contract).

## D09 — Scenario contract

Owner: [D09](spec-0.2/model-and-migration.md#d09--scenario-contract).

## D10 — Artifact registry and compiler boundary

Owner: [D10](spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary).

## D11 — Test binding and observation

Owner: [D11](spec-0.2/proof-and-editing.md#d11--test-binding-and-observation).

## D12 — Transactional spec editing

Owner: [D12](spec-0.2/proof-and-editing.md#d12--transactional-spec-editing).

## D13 — Attestation v3

Owner: [D13](spec-0.2/proof-and-editing.md#d13--attestation-v3).

## D14 — Schema migration

Owner: [D14](spec-0.2/model-and-migration.md#d14--schema-migration).

## D15 — Implementation sequence

Owner: [D15](spec-0.2/delivery.md#d15--implementation-sequence).

## D16 — Acceptance gates

Owner: [D16](spec-0.2/delivery.md#d16--acceptance-gates).

## D17 — Knowledge Graph v2 as compiler IR

Owner: [D17](spec-0.2/graph.md#d17--knowledge-graph-v2-as-compiler-ir).

## D18 — Implementation hygiene and documentation surface

Owner: [D18](spec-0.2/hygiene.md#d18--implementation-hygiene-and-documentation-surface).

## D19 — Cycle context envelope and token discipline

Owner: [D19](spec-0.2/context-and-orchestration.md#d19--cycle-context-envelope-and-token-discipline).

## D20 — Host-owned orchestration and verified independence

Owner: [D20](spec-0.2/context-and-orchestration.md#d20--host-owned-orchestration-and-verified-independence).

## D21 — Iron Law assurance kernel

Owner: [D21](spec-0.2/assurance.md#d21--iron-law-assurance-kernel).

## D22 — Profiles, cadence, and background scheduling

Owner: [D22](spec-0.2/assurance.md#d22--profiles-cadence-and-background-scheduling).

## D23 — Verdict, attestation, compatibility, and acceptance

Owner: [D23](spec-0.2/assurance.md#d23--verdict-attestation-compatibility-and-acceptance).

## D24 — MCP as optional transport and bounded projection

Owner: [D24](spec-0.2/mcp.md#d24--mcp-as-optional-transport-and-bounded-projection).

## Appendices

- [Evidence snapshot](spec-0.2/evidence.md#evidence-snapshot)
- [Assurance evidence](spec-0.2/assurance-evidence.md#iron-law-cadence-and-assurance-invalidation)
- [Claim discipline](spec-0.2/decision-log.md#claim-discipline)
- [Rejected decisions](spec-0.2/decision-log.md#rejected-decisions)
- [Executable validation protocol](spec-0.2/validation.md)
- [Evolution queue](spec-0.2/decision-log.md#evolution-queue)
- [Change log](spec-0.2/decision-log.md#change-log)
