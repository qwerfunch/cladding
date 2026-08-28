<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — MCP boundary

> Canonical owner of D24. Return to the [Spec 0.2 continuation router](../spec-0.2.md). Reproduce the validation projection through [Validation protocol](validation.md), not by copying measurements into this contract.

## D24 — MCP as optional transport and bounded projection

MCP is an adapter over the Spec compiler, transaction engine, GraphIR, and assurance reducer. It is not another specification authority, graph implementation, proof reducer, or lifecycle writer. CLI, MCP, and in-process callers must invoke the same domain operations and obtain the same semantic result for the same inputs. Turning MCP off may remove convenience and live projection, but must not change compilation, staleness, gate, or verdict semantics.

The minimum supported MCP host needs only tools. Resources, prompts, subscriptions, and future sampling are optional accelerators. A host that ignores resource updates or never reads a prompt must still be able to complete a supported cycle through tools. A host that cannot observe `notifications/tools/list_changed` must reconnect or relist after initialization; the server advertises the capability and never assumes that a cached pre-init catalog expanded.

### Authority and composition

| Layer | Owns | Must not own |
|---|---|---|
| Spec compiler and GraphIR | identities, normalized contracts, closures, impact, projections | transport framing or host behavior |
| Transaction and assurance kernels | write sets, revisions, recovery, obligations, evidence reduction, verdict | MCP-specific duplicate mutation/proof logic |
| MCP adapter | discovery, schemas, bounded serialization, text/structured compatibility, transport errors | alternate facts, joins, staleness, or GREEN authority |
| Host | when to call, model/context orchestration, optional resource/prompt use | weakening domain preconditions or claiming unobserved evidence |

Every mutating tool follows prepare/validate/apply semantics where user consent or a multi-file boundary exists. Domain errors are stable structured results and have text-content parity for clients that ignore `structuredContent`. Unknown, stale, malformed, oversized, out-of-root, unsupported, and unverified inputs fail closed without partial writes.

### Surface roles

The public catalog is described by operation, not persona:

| Role | Examples | Context rule |
|---|---|---|
| Bootstrap | prepare, stage, initialize, clarify | Pre-init exposes only bootstrap tools; initialized tools arrive through list-changed/relist. |
| Inspect | feature, context, working set, impact, graph | Return bounded projections with omission and revision metadata. |
| Spec edit | create, link, resolve, future `clad_edit_spec` | Invoke the one transaction engine and declare the smallest write set. |
| Verify | check, gate, verdict, oracle | Invoke the assurance kernel; transport cannot manufacture observation. |
| Observe | events, resources, subscriptions | Optional delivery; a notification is not adoption or proof. |
| Release | changelog and release-scope reductions | Preserve the same profile and closure used by CLI/in-process entry points. |

A code-owned `McpSurfaceDescriptor[]` with task-profile projections is a candidate consolidation, not an accepted runtime change. It may replace scattered registration only after schema, annotations, handler identity, dynamic discovery, and catalog ordering are parity-tested. Task-scoped catalogs are likewise a challenger: their byte reduction alone cannot justify a cutover if hosts fail to discover required tools.

### Validation ladder

The validation suite separates claims that are often conflated:

1. **Wire conformance:** initialize negotiation, declared capabilities, schemas, list/get/call behavior, error framing, and text/structured parity.
2. **Semantic parity:** MCP, CLI, and in-process callers reach the same compiler/edit/assurance operation and normalized result.
3. **Mutation safety:** consent, path bounds, size bounds, optimistic concurrency, journal recovery, idempotent replay, and rollback.
4. **Reference-host efficacy:** one supported host completes a real Spec 0.2 spec-edit → implementation → verification → attestation cycle using MCP where routed.
5. **Efficiency when used:** an equivalent successful task uses fewer measured input/output tokens or less active time without worse correctness, retries, or omissions.
6. **Observed adoption:** agents voluntarily pull the surface across completed cycles under the existing B1 telemetry thresholds.

Each rung requires its own evidence. Wire success does not prove end-to-end efficacy; efficacy does not prove efficiency; efficiency when forced does not prove adoption. The 0.10.0 MCP release gate is deterministic conformance, semantic/mutation parity for shipped Spec 0.2 operations, and one reference-host end-to-end cycle. Multi-host adoption and token advantage remain reported but non-blocking.

### Preregistered MCP scenarios

The executable ledger owns the exact IDs; these groups define their intent:

| ID | Scenario | 0.10.0 role |
|---|---|---|
| MCP01 | handshake and capability negotiation | blocking |
| MCP02 | pre-init bootstrap, list-changed, relist/reconnect | blocking |
| MCP03 | text and structured-content semantic parity | blocking |
| MCP04 | CLI/kernel/MCP semantic parity | blocking as each 0.2 operation lands |
| MCP05 | prepare/apply replay and rollback | blocking |
| MCP06 | different-write-set concurrency and same-write-set stale rejection | blocking |
| MCP07 | malformed, oversized, traversal, symlink, and out-of-root inputs | blocking |
| MCP08 | graph/context/catalog byte budgets and omission metadata | blocking for hard ceilings; efficiency claim non-blocking |
| MCP09 | F5 receipt ingestion/offline verification and asserted fallback; F9 registered human/blind production paths | blocking at each owning feature boundary |
| MCP10 | tools-only host with resources/prompts/subscriptions absent | blocking |
| MCP11 | reference-host full Spec 0.2 cycle | blocking before 0.10.0 release, not before F1 starts |
| MCP12 | delivery-versus-pull adoption telemetry | measurement; adoption result non-blocking |

An unimplemented operation is `implementation_pending`; an available but unexecuted host scenario is `not_run`; missing discriminating evidence is `inconclusive`. None is serialized as pass.

### Context and token accounting

Every deterministic measurement reports:

- the exact controlled UTF-8 bytes after final serialization;
- the estimator name (`characters_div_4_ceiling` in the contributor harness) rather than calling it a tokenizer;
- provider-reported input, output, cached-input, and reasoning tokens when a host exposes them;
- cache state as `cold`, `warm`, or `unknown` without inference;
- payload, resident catalog/instructions, tool results, retries, and total as separate quantities.

“Waste” is only the positive byte/token difference between two executions that produced the same required semantic output and passed the same fault checks. Large context, an unused field, or a smaller challenger is not waste by inspection. Counterfactual equivalence must be stated in the result.

The committed deterministic comparison measures the full initialized catalog and task-profile challenger using canonical JSON bytes. It is a lower-level cost input, not provider token use. The executable ledger fixes AB01–AB12 across contract lookup, composite identity, impact/closure retrieval, purpose/criterion/capability edits, disjoint/same-shard concurrency, scoped proof, stale failure explanation, independence, and delivery-versus-adoption. A live host A/B runs those twelve tasks in two arms (current full catalog and the candidate projection), at most twenty-four host task calls. It records success, retries, missing-tool recovery, active time, provider usage, cache knowledge, fault-control detection, and resulting contract/verdict parity. If provider usage is unavailable, exact controlled bytes and wall time remain labelled estimates; no token-superiority claim is allowed.

### Change discipline

MCP optimizations follow challenger → simulation → acceptance → cutover. The validation command may recommend a challenger but cannot edit this owner or promote a decision. Maintainer acceptance updates this document and the central decision log first; implementation then changes the descriptor/adapter and parity fixtures together. A failed challenger leaves the existing surface intact.

The reproducible command is:

```sh
npm run validate:spec-0.2
npm run --silent validate:spec-0.2 -- --json
```

Its passing infrastructure validates the ledger and current wire facts only. D01–D23 remain implementation-pending until their own executable evidence lands.
