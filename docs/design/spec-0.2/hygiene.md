<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — implementation hygiene

> Canonical owner of D18. Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## D18 — Implementation hygiene and documentation surface

Spec 0.2 implementation should leave each touched subsystem smaller in authority surface even when the feature adds capability. “Compact” means one owner per fact, direct data flow, low branching, and no adapter or wrapper that exists only to rename an unchanged value. It does not mean compressed names, hidden invariants, or deleting explanation that carries a decision.

### Same-cycle supersession protocol

For every non-additive feature cycle:

1. inventory the code, document paragraphs, generated surfaces, and tests whose authority the feature may replace;
2. implement one replacement owner and prove its parity or intentional behavior delta independently;
3. cut every in-scope consumer to that owner;
4. run the deletion proof below and classify each candidate as `retire` or `retain-with-contract`;
5. delete retired code, forwarding wrappers, duplicate normative prose, and implementation-coupled tests in the same cycle;
6. consolidate the surviving tests around public contracts and failure modes, then run the feature and repository gates.

Do not optimize toward monotonically rising or falling LOC, file count, or test count. Optimize toward zero duplicate authority, zero unjustified production orphan, and the smallest test set that still distinguishes every governed failure. Record the disposition in the feature rationale or tests rather than creating another lifecycle ledger.

### Code and comments

- Keep the first compiler additive under `src/spec/compiler/`; do not mix parity work with an early replacement of `src/spec/types.ts`, `src/spec/load.ts`, graph v1, or detector inputs.
- Extract a helper only when it removes repeated policy or gives a stable test seam. Prefer a local expression over a one-use forwarding abstraction.
- Document exported behavior and non-obvious invariants. Use only applicable `@param`, `@returns`, `@throws`, and `@see` tags; do not add empty or restated tags to satisfy a visual template.
- Comments explain why, ownership, trust boundaries, or failure behavior. Delete comments that merely paraphrase the following code.
- A feature may clean adjacent code that shares its authority or execution path. Broad style rewrites and unrelated renames stay outside the feature cycle.

### Canonical documents and mirrors

- A policy has one canonical Markdown source. Entry documents give a compact summary and link to it rather than copying its full rule set.
- The six role-brief Markdown files under `src/agents/` (excluding its README) remain canonical sources; host/plugin copies are generated mirrors and are never edited independently.
- Role briefs retain unique scope, outcome, evidence, capability, and Soft Shell contracts. Repeated choreography and generic coding advice move to the shared cycle/style authority.
- Managed blocks such as the AGENTS persona map are owned by the artifact registry and regenerated through their existing producer.
- A documentation edit must preserve resolvable links, generated-mirror idempotence, glossary coverage, and the semantic edge that explains why the document exists.

### Deletion proof

Search results alone never prove dead code. Before deleting a source, export, script, or document, show that it has no:

1. static or dynamic import;
2. package/bin/hook/host entrypoint;
3. spec `modules`, test, oracle, evidence, or source-reference contract;
4. generated mirror or artifact-registry consumer;
5. runtime string lookup, plugin manifest, or external compatibility obligation.

Record the proof in the feature test or change rationale. `src/optimizer/preamble.ts` and `src/optimizer/tail.ts` are currently not production-consumed but remain protected by shipped spec contracts, so F1 does not delete them. The duplicated pseudo-reference helper in graph v1 and reverse index stays until the F8 cutover gives it one surviving owner. The measured broken `@see` set stays as an F5 negative-control until the strict source adapter repairs it.
