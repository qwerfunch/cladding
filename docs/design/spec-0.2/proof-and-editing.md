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
- JUnit attribute entities decode before exact selector comparison, and every
  emitted `file`/`classname` path carrier is retained for that comparison.
- Schema 0.2 proof sources and legacy test refs reject symlinked roots,
  ancestors, files, and realpaths outside the workspace rather than following
  outside bytes.
- Test, oracle, and evidence channels retain their distinct provenance. A positive channel cannot hide an explicit failure in another declared channel.

### Legacy binding fallback

Migration baseline is a narrow compiler/migration resolution, not a waiver or verified historic proof. D14 records an immutable, criterion-local authorization only after an accepted project decision.

- A criterion may resolve only its L2 Unit/Coverage rows to `migration_baseline` when that authorization exactly matches its current address and final intent and no current exact proof mechanism exists.
- A live binding, a reviewed/legacy exact selector (pass, fail, skipped, absent, stale, or unsafe), or a registered current static criterion rule takes precedence. Its `pass`/`fail`/`unobserved`/`na` is final for that snapshot; baseline never falls back behind it.
- Baseline never masks a source→selector→runner defect: restore the exact binding round trip first, then reduce its current result.
- Path-only historic refs have no executable selector and may use the baseline when otherwise eligible. A same-file pass is never evidence.
- Strict intent selected during reviewed migration becomes the immutable final target and remains eligible. Only a criterion newly authored after migration or whose recorded final target intent later changes is ineligible/revoked; a feature edit does not revoke an unchanged authorization. Source features not exactly `done` at preview are ineligible.
- Store legacy `test_refs` only in `migration-baseline-0.1-to-0.2.yaml`; hash a retained path-only file because no honest source span is known.
- A blind receipt locator is canonical `path` or `path#exact selector`; its
  issuer pass reduces only when that exact live binding has an observed pass.

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
- `modules` owns implementation and test paths. Structural `design_impact.artifacts` instead names only registered Tier-B `docs/design/**/*.md` documents; it must not double as source ownership or accept project-context, capability, or architecture contracts.
- A new schema 0.2 structural record snapshots every listed design document digest and resolves only after every retained document changes. A migrated schema 0.1 review record with no digest baseline has no automatic approval path: it cannot be overwritten, reclassified, or re-baselined into `review_required`. Only an explicit typed transition to `resolved` may change it, when the current record exactly matches its feature-local immutable `FeatureIntentBaseline.legacyStructuralReview`, after retaining the exact safe regular-file registered design-document set.
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
- A schema 0.2 completion prepares an in-memory `done` view under the F4 lock and writes no pending marker. Done-aware drift, compiler, and assurance work consume that view. Only a GREEN, independent completion with a v3 receipt may publish one F4 journal containing the exact feature replacement, required derived projections, receipt, and successful completion event after rechecking the original root, feature, attestation, and verification-input revisions. RED, refusal, error, stale input, or interruption before that journal leaves canonical completion artifacts byte-exact unchanged.

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
- The supported filesystem threat boundary is cooperative: every initialized specification or managed-artifact writer takes this lock and journals its replacement; observed/pre-existing symbolic links, out-of-root paths, and preimage mismatches fail closed. Pre-init onboarding and host wiring are outside this boundary. Node's portable APIs cannot provide `openat`/directory-FD compare-and-swap on macOS, Linux, and Windows, so a same-account process that deliberately ignores the lock and races pathname replacement is outside this boundary.
- Journaled domain lifecycle events are canonical; best-effort observer telemetry uses that same lock and is non-authoritative.

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
- `obligation_sha256` is a Merkle root over sorted normalized obligation results, including baseline basis. Persist `required`/`pass`/`na`/`migration_baseline` counts; when the last is nonzero, also persist baseline-receipt and resolution digests plus criterion and obligation counts.

Only an authoritative, profile-complete GREEN run writes v3. Current observed required results seal `observation_set_sha256` — sha256 over the sorted, de-duplicated identity array — plus `observation_count`, never the inline list; the `migration_baseline` summary has no observation identities and instead seals `baseline_receipt_sha256`, `resolution_sha256`, and the set digest `criterion_authorization_set_sha256`, so persisted size is bounded by the feature count rather than by obligations per feature. Reader, retention, and freshness comparisons cover those fields. A feature-completion entry may seal its proven impact closure; push/release entries seal their integration scope. The attestation policy continues to record engine and detector-catalog identity. A shared rule, capability outcome, required scenario, or prerequisite implementation change stales only features whose compiled closure references it; incomplete closure escalates instead of claiming selective freshness.

While Cladding itself remains schema 0.1 during F6, serialize a schema-tagged legacy contract node containing exact legacy `text`, supported `ears`/`condition`/`action`/`response` values, scanner state (`parsed | opaque | conflict`), `legacy_unclassified`, and the applicable baseline/exemption identity. Do not invent 0.2 purpose or kind. The deliberate F7 self-migration invalidates those transitional hashes and the first post-migration GREEN gate writes a pure-0.2 v3.

Receipts remain canonical files under `spec/evidence/`; attestation does not embed their bodies. It derives and seals the sorted set of current receipt identities and proof inputs. A stale or revoked receipt cannot be copied forward or automatically reissued merely to make attestation GREEN.

The feature-level `contract_sha256` remains deliberately broader than an individual proof receipt. Evidence receipts bind to the subject-level hash defined in D20, so editing an unrelated sibling criterion can stale the feature attestation without invalidating proof that never claimed to cover that sibling.
