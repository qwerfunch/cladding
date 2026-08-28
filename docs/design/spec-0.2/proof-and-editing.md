<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — proof and editing

> Canonical owner of D11–D13. Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## D11 — Test binding and observation

### Source carrier

Vitest/Jest begins with a title carrier:

```ts
it('[covers:F-ab12cd34/AC-12ab34cd] creates a session', () => {});
```

- Require the token at the start of the source test title.
- Permit consecutive leading tokens when one test independently covers several atomic ACs.
- Ignore bare IDs and organic ID mentions outside a registered carrier.
- Other frameworks use native metadata or annotation only after an adapter passes committed source→selector→JUnit round-trip fixtures.

The normalized IR is:

```ts
interface TestBinding {
  criterion: string; // F-id/AC-id
  framework: string;
  file: string;
  selector: string;
  carrier: 'title' | 'metadata' | 'annotation';
}
```

Source harvesting establishes a declared binding. A case-level JUnit record establishes observation.

- Any bound failure makes the AC failed.
- With no failure, at least one observed pass makes it verified.
- Skipped-only or absent results are unverified.
- A passing unrelated test in the same file is never evidence.
- An unknown composite address is a blocking reference error.
- Test, oracle, and evidence channels retain their distinct provenance. A positive channel cannot hide an explicit failure in another declared channel.

### Legacy binding fallback

The accepted migration policy is node-level baseline fallback because most current refs cannot be mapped honestly to a testcase.

- Store legacy `test_refs` only in `migration-baseline-0.1-to-0.2.yaml` for unchanged criteria.
- If a criterion has any live `[covers:]` binding, ignore all of its baseline refs. Never union the two sources.
- If the criterion's intent projection changes, end its baseline exemption and require a live supported binding or another qualifying proof channel.
- If a baseline ref becomes stale, do not rewrite the baseline; add an explicit live binding.
- Hash the whole referenced test file for a legacy path-only binding because no honest source span is known.

## D12 — Transactional spec editing

Expose `clad_edit_spec` as a typed operation batch, not JSON Patch and not a generic file editor.

Initial operation set:

- `project.set_description`, `project.set_purpose`, `project.set_policy`;
- `feature.create`, `feature.begin`, `feature.block`, `feature.archive`, `feature.set_title`, `feature.set_purpose`, `feature.set_links`, `feature.set_design_impact`;
- `criterion.upsert`, `criterion.remove`, `criterion.set_proof_refs`;
- `capability.upsert`, `capability.remove`;
- `architecture.set_layers`, `architecture_rule.upsert`, `architecture_rule.remove`;
- `scenario.upsert`, `scenario.remove`;
- `dependency.promote`;
- `evidence.revoke`;
- `project.upgrade_schema`.

Existing create, capability-link, oracle, and design-impact surfaces become thin adapters over the same mutation engine. No edit operation may set `status: done`; completion stays exclusive to `clad done`.

Operation semantics are deliberately narrow:

- `feature.block(reason)` requires a non-empty reason. It transitions `planned | in_progress → blocked`; an already-blocked feature with the same reason is an idempotent no-change, while a different reason replaces the current reason and records the transition. `done` must pass through `feature.begin` before blocking; archived and unknown features are no-write errors. `feature.begin` clears the reason.
- `feature.archive(reason, superseded_by?)` accepts every non-archived feature, records immutable archive metadata, and clears a blocked reason. Repeating the exact archive metadata is an idempotent no-change; different metadata, an unknown feature, or any attempted unarchive is a no-write error. An erroneous integrated archive must be reverted in version control.
- `feature.set_links` is a typed partial replacement of exactly `modules`, `depends_on`, and `capability_refs`. Omission preserves a field and `[]` clears it. Every replacement validates references, duplicates, self-edges, and the complete dependency graph for cycles.
- `dependency.promote` accepts only a current unambiguous inferable candidate; an already-authored edge is an idempotent no-change.
- `criterion.set_proof_refs` owns oracle/evidence declarations without making them verified observations.
- `evidence.revoke` removes exactly one content-addressed receipt. Receipts are otherwise create-only and immutable.

### Lifecycle start contract

Expose `clad begin <featureId>` as the CLI adapter over `feature.begin` so every implementation cycle has an explicit start boundary.

- Transition `planned | blocked | done` to `in_progress`. Beginning a done feature is a normal reopen, not a hidden contract exception.
- Treat an already-`in_progress` feature as an idempotent no-change success. Reject an archived or unknown feature with no spec, inventory, checkpoint, or event write.
- Capture the pre-batch state as one `feature_checkpoint`, change the status, refresh derived inventory, and apply any companion spec operations under the same journal. Recovery must expose either the complete begin or the byte-exact pre-begin state, never a status flip without its checkpoint.
- A batch may combine `feature.begin` with feature-local intent edits. One checkpoint covers the whole pre-batch state, and the result returns the post-commit context and input revisions.
- For schema 0.2, `clad done` accepts only `in_progress → done`; any other source status returns a no-write lifecycle error. The 0.1 compatibility path retains its shipped behavior.

### Revision and commit contract

- Read and projection tools return a `context_revision` for same-session delta reuse plus `input_revisions` keyed by logical artifact/region. These values have different authority and are never interchangeable.
- `context_revision` identifies the compiled projection and packing inputs. It may support `not_modified` or delta delivery only when the same session proves retention; it never authorizes a write.
- `input_revisions` are byte hashes of the canonical write regions derived for the requested operation. They are the only optimistic-concurrency precondition.
- The operation schema and registry derive read/write sets; callers cannot under-declare them.
- A caller supplies `input_revisions` for canonical write regions only.
- A shard-local operation requires only that shard's input revision. `project.upgrade_schema` requires the canonical workspace input revision.
- Prepare and validate patches without the commit lock.
- Acquire a short workspace commit lock with a five-second bounded wait.
- Under the lock, recover any journal, re-read input revisions, reload the latest full compiler inputs, apply the operation in memory, and validate all references.
- Different-shard concurrent edits wait briefly and both succeed against the latest IR.
- The second same-shard edit returns stale with no write.
- A lock timeout returns BUSY with no write; it is not reported as stale.
- Write a journal and before-images before same-directory temp-file replacement. On ordinary errors, write nothing. On process interruption, the next compiler or mutation run completes cleanup or restores byte-exact originals.
- Regenerate derived inventory/index state under the commit lock from the latest IR, but do not include derived regions in caller input revisions.

## D13 — Attestation v3

Retain the current per-module byte map and replace the feature `ok` marker with compact per-feature closure and assurance seals. [D21–D23](assurance.md#d21--iron-law-assurance-kernel) own profile and obligation semantics; this section owns the persisted freshness boundary.

### `contract_sha256`

Canonical serialization includes:

- feature ID, title, purpose;
- criterion IDs, parsed EARS AST, kind, rationale, and constraint refs;
- modules, dependencies, and capability refs;
- referenced capability outcomes and full architecture rules;
- active `design_impact` governance state;
- required scenarios that reference the feature;
- the applicable legacy-exemption identity for baseline-covered nodes.

Exclude YAML comments, formatting, ordering where order is non-semantic, and criterion notes.

### `verification_sha256`

Canonical serialization includes:

- binding address, framework, file, selector, and carrier;
- exact testcase source-span bytes, or whole-file bytes when the adapter cannot isolate a span;
- adapter-declared runner configuration that determines whether the testcase executes;
- oracle and evidence declarations plus their resolved bytes or resolver definitions;
- verified evidence receipts by full content address, including their method, issuer, subject and reviewed-input hashes, human runtime-dependency/author-set/criterion-matrix fields, and blind capability-manifest digest where applicable;
- whole-file bytes for baseline legacy test refs.

This digest must cover tests and evidence outside `feature.modules`; module hashing alone does not protect them.

### Runtime and assurance seals

- `runtime_dependency_sha256` seals the sorted implementation roots of every authored or observed prerequisite needed by the feature. Unknown dependency completeness cannot produce a scoped seal; D23 escalates that verification layer to the whole repository.
- `profile_sha256` seals the assurance profile, required level, policy, adapter/catalog, environment, and trust-snapshot identities.
- `obligation_sha256` is a Merkle root over the sorted normalized obligation results. Persist compact required/pass/NA counts rather than duplicating the live GraphIR ledger.

Only an authoritative, profile-complete GREEN run writes v3. A feature-completion entry may seal its proven impact closure; push/release entries seal their integration scope. The attestation policy continues to record engine and detector-catalog identity. A shared rule, capability outcome, required scenario, or prerequisite implementation change stales only features whose compiled closure references it; incomplete closure escalates instead of claiming selective freshness.

While Cladding itself remains schema 0.1 during F6, serialize a schema-tagged legacy contract node containing exact legacy `text`, supported `ears`/`condition`/`action`/`response` values, scanner state (`parsed | opaque | conflict`), `legacy_unclassified`, and the applicable baseline/exemption identity. Do not invent 0.2 purpose or kind. The deliberate F7 self-migration invalidates those transitional hashes and the first post-migration GREEN gate writes a pure-0.2 v3.

Receipts remain canonical files under `spec/evidence/`; attestation does not embed their bodies. It derives and seals the sorted set of current receipt identities and proof inputs. A stale or revoked receipt cannot be copied forward or automatically reissued merely to make attestation GREEN.

The feature-level `contract_sha256` remains deliberately broader than an individual proof receipt. Evidence receipts bind to the subject-level hash defined in D20, so editing an unrelated sibling criterion can stale the feature attestation without invalidating proof that never claimed to cover that sibling.
