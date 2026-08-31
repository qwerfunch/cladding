<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — context and orchestration

> Canonical owner of D19–D20. Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## D19 — Cycle context envelope and token discipline

The context objective is not “send less text” in isolation. It is to deliver every fact required for the current operation, omit unrelated facts, make omissions visible, and prove that the final physical request is bounded. A logical graph slice is insufficient evidence because system prompts, tool catalogs, schemas, escaping, hook cards, and prior tool results also occupy the model input.

### Task projections

Context is keyed by an operation, not by a persona name:

| Task profile | Required projection |
|---|---|
| `spec-edit` | The operation-derived read/write set: relevant intent, target contract node, referenced constraints, affected links, and canonical input revisions. |
| `implement` | Purpose, criteria, constraints, candidate affected paths, predicted write scope, prerequisites, required proof, current failure, and prior-attempt summary when present. |
| `verify` | Contract, observed write scope, changed artifacts, declared bindings, observed results, impact closure, evidence state, and freshness. |
| `observe` | Gate results, detector findings, proof freshness, attestation digest, and unresolved state; no implementation body by default. |
| `blind-oracle` | One criterion, public module signatures, target test path, subject/context revisions, and no implementation body or prior implementation result. |

These profiles are deterministic projection policies. Except for `blind-oracle`, they neither select a model nor restrict host permissions. A host may use one general agent for several profiles or several agents for one profile.

### Internal measurement contract

Use an internal envelope; do not change the frozen `clad_get_context` wire to expose it:

```ts
interface CycleContextEnvelope {
  task: 'spec-edit' | 'implement' | 'verify' | 'observe' | 'blind-oracle';
  feature: string;
  context_revision: string;
  input_revisions: Readonly<Record<string, string>>;
  write_scope: {
    paths: readonly string[];
    provenance: 'predicted' | 'observed' | 'unknown';
  };
  sections: readonly ContextSection[];
  budget: {
    payload_utf8_bytes: number;
    resident_utf8_bytes: number;
    total_utf8_bytes: number;
    cache: 'cold' | 'warm' | 'unknown';
    estimator: string;
    estimated_tokens: {
      payload: number;
      resident: number;
      total: number;
    };
    omitted: readonly OmissionSummary[];
    required_overflow: boolean;
  };
}
```

`payload_utf8_bytes` measures the final task packet after revision, write-scope, budget, and omission metadata are serialized. `resident_utf8_bytes` measures every Cladding-controlled input present outside that packet for the same model request: role/system text, MCP server instructions and catalogs, tool schemas, hook cards, and retained Cladding tool results or retry summaries. `total_utf8_bytes` is their exact sum. Classify each byte once. Provider-owned hidden context is outside this total; when a provider reports input/cache/output tokens, record those alongside the envelope rather than substituting them for it. The cache field describes the observed resident-prefix state and stays `unknown` when the host cannot prove it.

Measure and classify all Cladding-controlled input:

- optional role-brief/system text;
- task packet and final provider/MCP JSON after escaping;
- MCP server instructions, tool catalog, and tool schemas;
- tool results and retry/prior-attempt summaries;
- hook push cards;
- context/input revisions, cursor, budget, and omission metadata.

Exact UTF-8 bytes are primary. Token estimates always name their estimator. Provider-reported input, cache-read, cache-write, and output tokens are recorded only in live same-host A/B runs. Cold catalog cost and warm cached cost are separate results.

### Packing and reuse

- Required contract facts are never silently truncated. If they do not fit, return `required_overflow` and the exact oversized section rather than a plausible-looking partial contract.
- Pack optional sections in task-specific priority order, aggregate omission metadata, serialize the complete payload, and remeasure until byte/token totals reach a fixed point.
- Fresh agents receive the full mandatory core. Delta and `not_modified` responses require a proven same-session `context_revision`; a matching git revision alone does not prove that a new agent retained prior context.
- Before an edit, derive `write_scope` from the operation's predicted write set. After an edit, replace it with paths observed from the actual diff. Impact traversal starts from these paths, not from every path in `feature.modules`.
- An unknown write scope is explicit and never means empty impact. Keep module ownership/fan-out summaries available lazily, surface incompleteness, and request or observe a narrower path set before claiming a complete regression closure.
- Avoid repeating the same project, criterion, path, or proof fact inside one envelope. References may point within the envelope by stable address.
- A verification projection always retains `{criterion, state, selector, locator-or-digest}` for every relevant proof. Diagnostics are failure-first optional detail packed only with remaining budget.
- An internal `diagnostic_cursor` may continue omitted diagnostics only within the same session and `context_revision`. It is not a public GraphIR cursor and does not change the frozen `clad_get_context` v1 wire.
- Keep the shipped hook limits of 600 characters per push card and 2,500 estimated tokens per session. Measure the complete MCP catalog and ratchet its sorted serialized bytes separately from task payloads; adding a public capability may raise the ratchet only through a reviewed catalog diff.

Initial payload ceilings are task-profile rules: 16 KiB for `spec-edit`, `verify`, and `observe`; 24 KiB for `implement` and `blind-oracle`. They do not claim that total cold context fits inside them. `spec-edit` scopes required content to the typed operation: a criterion operation includes feature intent, the target criterion, referenced constraints, affected links, and its write set; a feature-level operation may require the whole feature; deterministic global migration is executed by the compiler rather than sending the whole corpus to an agent. Across the self corpus, required semantic-address recall is 100%, forbidden blind data leakage is zero, avoidable duplicate facts are zero, and `required_overflow` is zero. A future legitimately huge feature may return honest overflow instead of truncation. Comparable contract-only p50 and p95 payload and total bytes may not regress from 0.1; a 20% payload p50 reduction is a target, not permission to drop required facts.

### A–E simulation

Run the same preregistered work items through:

- **A — shipped persona path:** current developer/reviewer prompts and dispatch packet;
- **B — one general host agent:** task profiles with no general persona prompt;
- **C — several general host agents:** the same task profiles split by the host;
- **D — restricted blind oracle:** fresh context plus enforced negative capabilities;
- **E — legacy reconstruction:** the reads/greps/tool calls needed to reconstruct the same facts without the new projection.

A, B, and C must produce the same contract addresses, deterministic gate result, verdict, stale closure, and observed write-scope impact. Only verified evidence provenance may change the independence label. Removing purpose, criterion identity, constraint rationale, selector, provenance, direction, impact, or freshness must fail the corresponding ablation. Removing every general persona prompt must not stop the cycle or alter a gate.

Fixtures cover every self-corpus feature plus small, p50, p95, and maximum packets; shared-module hubs; deep dependency closures; proof-heavy and unresolved nodes; retries; non-ASCII content; blind signatures; and a 5,000-feature synthetic graph. A no-retry full cycle's p50/p95 Cladding-controlled input may not regress against the comparable shipped path. D24's AB01–AB12 live A/B may support only a task-scoped efficiency claim; broader GraphIR generalization requires the separately preregistered optional expansion described by D17.

## D20 — Host-owned orchestration and verified independence

This decision refines the shipped role-contract architecture; it does not invert it. The current orchestrator and managed AGENTS contract already say that the host owns agent count, names, models, threads, and parallelism, while Cladding declares outcome conditions and judges recorded evidence. Current specialist Markdown already describes selectable role briefs. The remaining mismatch is the fixed five-step persona narrative in the cycle guide and the experimental headless loop's hard-coded developer/reviewer dispatch.

### Enforcement boundary

Cladding enforces invariants, not a roster:

- the host chooses whether one or many general agents plan, edit specs, implement, test, review, or observe;
- deterministic gates judge filesystem, contract, observation, and evidence truth independently of the chosen topology;
- a same-author verification pass is allowed but remains `self-certified`;
- no gate or verdict depends on a general persona ID;
- identity matters only when a claim requires independent evidence;
- a new enforced role is admitted only when an ablation proves that its negative capabilities are necessary for the guarantee.

Role briefs remain because their domain contracts measurably steer interpretation and serve as interface manuals for hosts that want them. They are optional execution aids, not the source of gate authority. The blind profile is the exception: not seeing implementation is an epistemic precondition, so its fresh context and negative capabilities must be evidenced rather than promised in prose.

### Evidence assurance and canonical receipts

Keep `identity.author` and add a 0.2 assurance boundary:

```ts
type EvidenceAssurance = 'asserted' | 'verified';
type ReceiptCheck = 'pass' | 'fail';

interface ReceiptBase {
  receipt_schema: '1';
  issuer: string;
  issuer_key_id: string;
  issuer_proof: string;
  subject: `feature:${string}` | `criterion:${string}/${string}`;
  subject_sha256: string;
  observed_at: string;
}

interface HumanReceiptBase extends ReceiptBase {
  method: 'human_channel';
  reviewed_inputs_sha256: string;
  runtime_dependency_sha256: string;
  implementation_authors_sha256: string;
}

interface AuditReceipt extends HumanReceiptBase {
  claim: 'audit';
  subject: `criterion:${string}/${string}`;
  checks: Readonly<{
    evidence_sufficiency: ReceiptCheck;
    code_test_review: ReceiptCheck;
    independence: ReceiptCheck;
  }>;
}

interface UatReceipt extends HumanReceiptBase {
  claim: 'uat';
  subject: `feature:${string}`;
  criterion_verdicts: Readonly<Record<`criterion:${string}/${string}`, ReceiptCheck>>;
  checks: Readonly<{
    no_surprise: ReceiptCheck;
    tradeoff_acceptance: ReceiptCheck;
  }>;
}

type HumanReceipt = AuditReceipt | UatReceipt;

interface BlindReceipt extends ReceiptBase {
  method: 'blind_capability';
  claim: 'independent_oracle';
  verdict: 'pass' | 'fail';
  evidence: { locator: string; sha256: string };
  capability_manifest_sha256: string;
}
```

Receipts live at `spec/evidence/<F-id>/<full-sha256>.yaml`: the feature directory is derived from `subject`, and the filename is the SHA-256 of the complete canonical receipt including its signature. There is no duplicate body ID. Receipts are create-only committed evidence, not regenerable output; `evidence.revoke` removes an exact receipt.

Receipt schema 1 uses a detached Ed25519 signature over a newly defined canonical frame. Parse the YAML into a JSON-compatible value, rejecting aliases, tags, non-string map keys, non-finite numbers, and other non-JSON values. Remove `issuer_proof`, serialize the remaining value with RFC 8785 JSON Canonicalization Scheme, and encode it as UTF-8 `payload`. Let `domain` be the ASCII bytes of `cladding.receipt/1`; the signed bytes are `u32be(domain.length) || domain || u64be(payload.length) || payload`. Store the signature as unpadded base64url. After inserting `issuer_proof`, compute the lowercase hexadecimal filename SHA-256 over the RFC 8785 UTF-8 bytes of the complete receipt. `verified` and the receipt verdict are derived, never stored.

The strict gate is synchronous and offline. `issuer_key_id` selects an Ed25519 SPKI key from an immutable trust snapshot supplied by the Cladding installation or registered host adapter outside the writable workspace; the gate and attestation record that snapshot's digest using UTF-16 code-unit canonical ordering. Supplied deterministic digest mismatches fail before trust lookup, including for an unknown key; missing context plus unknown trust remains unresolved/asserted. The verifier checks the signature and recomputes the subject, runtime-dependency, implementation-author, reviewed-input, evidence, and capability-manifest hashes without a network lookup. A missing verifier, unknown key, or online-only identity leaves the evidence unresolved/asserted and cannot satisfy UAT or required independence. A networked host channel may verify identity at ingestion time only if it emits this portable signed proof; later gates recheck bytes and signatures locally.

`subject_sha256` is canonical and address-sensitive:

- For a criterion subject, hash the feature purpose, referenced capability outcomes, the target criterion's ID and parsed contract, its local/referenced constraint rationales, applicable required-scenario intent, and any legacy-exemption identity. Exclude sibling criteria, modules, notes, formatting, and unrelated scenarios or rules.
- For a feature subject, use the full feature `contract_sha256` closure from D13.
- A receipt never transfers between addresses even when two subject serializations happen to be equal.

Scenario applicability is conservative and explicit because schema 0.2 has no
criterion-level scenario edge. When `project.scenario_policy` is `required`,
every scenario whose `feature_refs` contains the parent feature applies to every
criterion in that feature. Hash sorted records of scenario ID plus `actor`,
`goal`, `success`, and ordered `steps`. Under `off | advisory` no scenario enters
the criterion subject hash. Removing the parent feature ref removes that record;
changing an unrelated scenario or sibling criterion does not stale the target
criterion receipt. A future narrower rule requires an explicit schema edge and
must not infer criterion coverage from step prose.

A human receipt additionally binds the sorted runtime dependency closure, including the feature's complete module paths and bytes and explicit missing-file sentinels. `implementation_authors_sha256` hashes the sorted unique normalized `{root, assurance, author, name}` mutation-provenance records for every implementation root in that closure; an unattributed root receives `{root, assurance: 'asserted', author: 'unknown', name: ''}`. Hashing binds the declared mapping; it does not upgrade asserted identity into verified identity. An incomplete author mapping leaves an independence requirement unobserved, and a matching verified issuer remains self-certified.

An Audit receipt is criterion-scoped and records the three named checks above. A UAT receipt is signed once per feature but its `criterion_verdicts` addresses every current composite criterion: each value is that criterion's intent-alignment decision, while the two named feature checks cover negative space and accepted trade-offs. A UAT pass requires the exact current criterion set and every criterion/check to pass. Any explicit fail is an applicable failure even if the rest of the matrix is incomplete; an unknown address invalidates the receipt, and a missing address remains unobserved rather than passing. The reducer derives the receipt verdict, so no persisted summary can disagree with its checks. Editing a shared or prerequisite module, reviewed input, author set, trust snapshot, or signature therefore stales every receipt whose closure includes it. [D21–D23](assurance.md#d21--iron-law-assurance-kernel) own reduction and escalation.

A blind receipt binds the exact evidence locator and bytes plus the capability manifest. It contributes independent provenance only when a current observed testcase pass confirms the bound criterion; a receipt for an unexecuted blind test remains unverified. Blind evidence never substitutes for UAT.

- `asserted` records useful history but cannot satisfy a new 0.2 independence requirement.
- `verified` means the offline verifier accepted a supported signed channel or isolation boundary. It proves the registered issuer's assertion, not universal human identity.
- A receipt is bound to the current subject hash. A target criterion, relevant constraint/outcome/scenario, or feature-level subject change makes it stale; editing an unrelated sibling criterion does not.
- A verified human receipt contributes to feature independence and clears only the matching Audit or UAT obligations when its complete claim-specific checks reduce to pass.
- A verified blind receipt contributes to feature independence but never substitutes for UAT or another human-only rule.

F5 owns receipt schema, canonical framing, offline verification, trust-snapshot
resolution, validated ingestion, content-addressed storage/revocation, and
reducer wiring. Its deterministic fixtures may supply signed receipts, but F5
ships no product issuer that can manufacture verified human or blind evidence.
It introduces `clad signoff`; bare TTY or pseudo-TTY input records asserted audit
history only. Without a registered issuer, verified signoff returns
`HUMAN_REQUIRED`. There is no `--verified` bypass. OS/git identity, caller text,
generic `blind: true`, and hand-written YAML are asserted only.

Keep `clad_author_oracle` readable for 0.1. Under 0.2, a registered adapter must supply a fresh-context/capability receipt before the result is verified blind. The generic MCP `blind: true` flag remains readable but records only asserted/attested provenance and cannot satisfy `independence_policy: require`.

### Runtime rollout

F9 ships the envelope, task projections, A–E invariance suite, and the first real
registered issuer paths: a human signing adapter and a fresh-context/capability
blind adapter. Human private keys remain in the OS secure store; CI mechanism
evidence is a live adapter round trip on macOS Keychain, Windows Credential
Manager, and Linux Secret Service/dbus. Fixture trust snapshots prove protocol or
mechanism only, never live human evidence. Both adapters call F5 ingestion and
emit portable receipts for offline verification. Only real human-signed MCP11
receipts count as live human evidence. F9 preserves the experimental
developer→reviewer loop. F10 introduces its 0.10.0 task-state loop only after:

1. A–E proves topology-invariant contracts, gates, verdicts, and stale closures;
2. verified human and blind evidence are produced through real product paths;
3. `independence_policy: require` is no weaker than before;
4. blind leakage remains zero;
5. general role-brief removal changes no deterministic result.

The F10 loop may request `implement`, `verify`, or `observe` work, but those are operations rather than required identities. The host may satisfy several with one agent; receipts and evidence, not dispatch count, decide independence. Rich public GraphIR cursors, viewer expansion, and broader retrieval generalization remain non-blocking tail work; F9's session-local `diagnostic_cursor` is a narrow task-projection exception.
