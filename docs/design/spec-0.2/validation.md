<!-- Cladding · Tier C · executable validation guide · Refreshed by: manual -->

# Spec 0.2 validation protocol

This guide explains how to challenge the accepted design without confusing a sound test harness with a finished Spec 0.2 runtime. Normative decisions remain in the [continuation router](../spec-0.2.md) and its canonical owners; the committed requirement ledger is [`tests/design/spec-0.2/requirements.yaml`](../../../tests/design/spec-0.2/requirements.yaml).

## Reproduce

```sh
npm run validate:spec-0.2
npm run --silent validate:spec-0.2 -- --json
npx vitest run tests/design/spec-0.2
```

The command reads repository state and opens an in-memory MCP client/server pair. It does not mutate the spec, refresh attestation, run a provider, or accept a challenger. The Vitest suite additionally exercises the real pre-init → initialized dynamic-tool transition in a temporary workspace.

## Status vocabulary

| Status | Meaning |
|---|---|
| `pass` | The named executable check observed its required result. |
| `fail` | The check observed a contradiction or broken invariant. |
| `implementation_pending` | Accepted target behavior has no runtime implementation yet. |
| `not_run` | The scenario is implementable but this run did not execute it. |
| `inconclusive` | Some evidence exists, but it cannot establish the named claim. |

Only `fail` makes the contributor command exit non-zero during V0. That lets the validation boundary land before F1 while keeping pending and absent evidence visible. A feature acceptance gate may separately require a particular pending/not-run item to become pass before that feature completes.

## Current V0 coverage

The initial harness validates:

- D01–D24 have one declared canonical owner, one matching owner heading, one
  matching router navigation heading, and no normative heading in another
  routed document;
- the P/L/B/C/T/U/A matrix contains 37 unique preregistered IDs documented by D16;
- J01–J13 preserve model-simulated, implementation-pending, and reference-host-not-run journeys as different states;
- preregistration is not presented as 37 passing runtime cases;
- current MCP identifiers equal the live in-memory tool/resource/prompt catalog;
- dynamic tool discovery is negotiated and the real initialization path emits list-changed;
- every shipped tool belongs to at least one candidate task profile;
- exact catalog and document bytes use a named estimator and unknown cache by default;
- legacy host-smoke evidence is labelled legacy read-surface evidence;
- reference-host Spec 0.2 E2E, live token A/B, and unconfirmed adoption remain visibly unproven.

The model simulations currently compare composite versus bare criterion identity, shared versus feature-local capability writes, proof provenance versus persona topology, directed versus undirected graph projection, required versus advisory scenario freshness, upstream report strictness versus Cladding blocking, and every-edit versus tiered/background assurance cadence. These establish design mechanics and expose token/merge trade-offs; they are not substitutes for the pending production adapters.

AB01–AB12 is the bounded first comparison for the task-scoped MCP challenger and may support claims only on those tasks. D17 retains a separately preregistered larger retrieval study—40 tasks is the current optional candidate—only for later generalization; it is not a 0.10.0 gate and cannot prove adoption.

It does not validate the unimplemented 0.2 compiler, migration, transaction, GraphIR v2, receipt, assurance, scheduler, or attestation behavior. Those checks become executable beside F1–F9 and replace `implementation_pending` one decision/scenario at a time.

## Independent-oracle rule

A validation fixture must not calculate its expected answer with the production join, traversal, parser, revision, closure, or reducer it is testing. Small hand-authored records, byte snapshots, property invariants, and independent sorted-record scans are preferred. Do not build a giant shadow compiler: it would become a second authority and could drift in the same direction.

For each accepted decision, record:

1. the owner and exact scenario ID;
2. the independent oracle or fault injection;
3. controlled inputs and final serialized outputs;
4. status and evidence location;
5. implementation or environment prerequisites;
6. a negative control that fails when the claimed design element is removed.

## Challenger comparison

When simulation suggests a better design, add it as a named challenger. Compare the accepted and challenger variants against the same correctness, failure-injection, concurrency, retrieval, context, and token fixtures. A challenger wins only if it preserves every required invariant and materially improves its preregistered objective. The harness reports the result; it never silently rewrites canonical owners.

For MCP and LLM context comparisons, measure final UTF-8 bytes, named token estimates, provider usage when available, cache state, retries, and active time. Count avoidable bytes only when both arms produce the same required semantic output. Forced tool use may prove “efficiency when used”; only voluntary pull telemetry across completed cycles can prove adoption.

## Feature boundary

V0 is an additive pre-F1 safety boundary. Each later feature:

1. changes its ledger entries from pending to executable only when fixtures exist;
2. runs the focused design simulation before production edits;
3. implements through the canonical kernel and adapter boundary;
4. runs the negative control and relevant integration journey;
5. updates the owner and decision log only for an accepted design change;
6. completes through the ordinary contributor and `clad done` gates.

The complete target is not one global “simulation passed” badge. It is a ledger in which every release-required scenario has discriminating evidence and no pending/not-run state remains inside that release boundary.
