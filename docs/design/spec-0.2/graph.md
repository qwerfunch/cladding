<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — GraphIR and bounded retrieval

> Canonical owner of D17. Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## D17 — Knowledge Graph v2 as compiler IR

> Implementation-cycle trace: `feature:F-208eaa79` is the F8 implementation shard for this accepted D17 contract; D17 remains the normative authority.

### Primary justification and guarantee boundary

Knowledge Graph v2 is first an internal compiler representation, not an LLM feature. The Spec compiler builds one live graph that supplies:

- `contractClosure` for attestation v3 and contract freshness;
- `subjectClosure` for criterion/feature evidence-receipt freshness without sibling over-invalidation;
- `verificationClosure` for binding, observation, oracle, evidence, and proof freshness;
- direction-aware dependency and predicted/observed write-scope impact queries;
- document and source reference resolution;
- graph export and optional bounded LLM projections.

The closures are single implementations, not parallel graph consumers that reproduce the same joins. GraphIR, attestation, `UNTESTED_AC`/`UNVERIFIED_AC`, impact analysis, and working-set assembly must call those implementations. This is the release justification even if no agent ever invokes an MCP retrieval tool.

The graph guarantees structural fidelity, address resolution, provenance separation, freshness inputs, and deterministic query results. It does not prove that a requirement is true, that the implementation satisfies unstated intent, that an LLM uses the graph, or that using it improves implementation correctness.

### Why v1 cannot remain the compiler model

| v1 defect | Verified self-corpus consequence | v2 correction |
|---|---|---|
| No criterion node | 1,118 criteria and 1,557 criterion-proof relationships cannot be represented. | Composite-address criterion nodes and criterion-level proof edges. |
| One path becomes kind twins | 95 paths materialise as more than one module/test/doc node, giving one artifact several identities. | One artifact node with several roles. |
| Undirected generic BFS | Depth 2 exceeds 3,000 estimated tokens for 124/281 feature queries; an unbounded feature query reaches about 72k estimated tokens. | Relation-specific directions, no project-hub expansion, and projection-first reads. |

v1 remains a historical shipped design, not a compatibility target. GraphIR v2 replaces its node/edge model and graph wire representation in 0.10.0. No v2-to-v1 graph serializer is retained.

### Canonical identities

Semantic addresses are:

- `project`;
- `capability:<id>`;
- `feature:<F-id>`;
- `criterion:<F-id>/<AC-id>`;
- `scenario:<id>`;
- `architecture_rule:<id>`.

Physical addresses are `artifact:<normalized-repo-path>` and `anchor:<path>#<stable-selector>`. Bare AC ids are never externally resolvable. A source line is a navigation hint, not identity.

An artifact has any applicable roles from `spec | doc | source | test | oracle | evidence | skill | generated`. A canonical signed receipt is one immutable `evidence`-role artifact; the graph exposes its address, provenance, state, and digest rather than duplicating its body. A doc section, source reference, or testcase is an anchor on its artifact. Project membership is artifact metadata rather than a traversal edge, so inventory membership cannot turn the project node into a whole-repository two-hop hub.

### Edges, ownership, and truth status

GraphIR uses these relations:

- structure: `contains`, `defined_in`, `contributes_to`, `depends_on`, `participates_in`;
- implementation boundary: `touches`, `constrained_by`, `traces_to`;
- proof: `covers`, `supports`;
- documents: `explains`, `mentions`, `links_to`.

Every edge records `provenance: authored | derived | observed` and an owner locator. Where truth is observed, the edge also carries `resolved | unresolved | passed | failed | skipped | stale | unknown`. A test title's `[covers:F-id/AC-id]` is authored; a matching JUnit testcase is observed. They may be joined but never collapsed into one fact. A declaration with no observation is not verified, and absence in an empty ledger is unknown rather than safe.

F1 materialises only relationships authored inside Spec 0.1 plus their structural targets. A legacy `test_refs`, `oracle_refs`, or `evidence_refs` entry becomes an authored `supports` edge with its channel, raw spelling, selector precision, owner locator, and `resolved | unresolved` state; it does not become `covers`, `passed`, or `verified`. File and registry lookup may resolve an address structurally, but it is not proof observation. Source-comment harvesting, `[covers:]` carriers, framework selectors, case-level JUnit, and executable oracle/evidence adapters land together in F5.

The structural resolver never guesses an alias for an absent target. In the current corpus, `self-dogfood:stage:commit-postcommit` remains unresolved rather than being silently rebound to the nearby `stage:commit` script. The original reference remains available for diagnosis and later explicit repair.

Default traversal is relation-aware. Forward prerequisites and reverse dependents are distinct operations; containment may add a parent as orientation without expanding all siblings; an artifact query fans out to every owner. Full graph export remains an explicit CLI operation.

### Documents and source references

The artifact registry enumerates canonical documents and classifies design/operational contracts, general/legal material, generated output, mirrors, and fixtures. Every canonical document becomes an artifact even when it has no semantic edge. Tier A/B and design/operational-contract documents require an explicit semantic binding; general/legal/generated documents require link integrity only.

When the F5 document/source adapters land, explicit `clad-doc-links` declarations compile to `explains`; organic ids compile to non-authoritative `mentions`; tracked repo-local links compile to `links_to`; and existing `@see spec/features/<shard>.yaml AC-…` comments compile to `traces_to`. Declared references are strict after that cutover even though adding a source reference remains optional. Until then, F1 does not ingest source comments or change Spec 0.1 blocking behavior; the measured broken `@see` set is retained as an F5 negative-control fixture.

`spec/generated/_doc-links.yaml` is the final generated, greppable projection after F11 relocation. If its format changes to typed addresses, the extractor, writer, `DOC_REFERENCE_INTEGRITY`, GraphIR reader, sync idempotence fixtures, and downgrade/regeneration fixture change in one feature cycle. The file is never a second graph authority.

### Public wire boundary

`clad_get_context` is not a graph-v1 adapter. It is a separately accepted, frozen no-code context-slice contract. Keep its exact shape and `schema_version: 1` throughout 0.10; do not revise F-06dfdad6 merely to make it resemble GraphIR. Replace the server-wide version assumption with per-surface constants so `clad_get_graph` can emit graph `schema_version: 2` without changing unrelated tools.

The 0.10.0 release-blocking outward work is the minimum atomic v2 cutover: focused graph JSON, CLI query/export, and enough renderer/viewer support that existing graph commands are not broken. The default focused graph read is depth 1 and bounded; a no-query MCP call returns statistics, not the graph.

Richer semantic packets are a tail consumer. If implemented, they present sparse, deterministic sections in the order WHY, WHAT, constraints, affected paths, proof, impact, documents, and health. Human-readable keys remain intact; empty/default fields are omitted; criterion ids may be locally scoped under a feature. Default task projections include receipt summaries only, never signatures or full receipt bodies. Packing measures the complete serialized payload to a fixed point, including context/input revisions and omission metadata. `token` figures must name their estimator and report exact serialized bytes because provider tokenizers differ.

### Claim ladder and rollout

Keep three independent claims:

1. **Structural validity** — permitted after committed fidelity, query-reconstruction, negative-control, freshness, and ablation tests pass.
2. **Retrieval efficiency when used** — permitted only after a preregistered same-host/model/settings benchmark preserves exact-address accuracy while reducing measured input. This says nothing about correctness beyond the benchmark task.
3. **Actual adoption** — permitted only when the existing pull telemetry reaches `confirmed`. A successful retrieval A/B cannot raise adoption; current recorded evidence is `not_confirmed`.

Therefore the internal IR, closures, detectors, attestation, and minimum graph v2 wire block 0.10.0. D24's AB01–AB12 two-arm run is the bounded first experiment for a task-scoped MCP surface; a pass supports only efficiency-when-used on those tasks. A separately preregistered broader study—40 tasks is the current optional scale candidate—may generalize the GraphIR retrieval claim in 0.10.x, but neither experiment blocks 0.10.0 or proves adoption. Viewer polish, broader MCP projections, and public graph cursor/`not_modified` expansion remain independent tail work. D19's session-bound `diagnostic_cursor` is not a graph-wire exception.
