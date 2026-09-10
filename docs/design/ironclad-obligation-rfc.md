<!-- Cladding · Tier B · non-authoritative upstream proposal · Refreshed by: manual -->

# Ironclad obligation model — RFC draft

> **Status: draft proposal only.** This document is a Cladding design input derived from the accepted [Spec 0.2 assurance design](spec-0.2/assurance.md#d21--iron-law-assurance-kernel) for a possible upstream Ironclad discussion. It is not part of the Ironclad standard, has not been submitted or accepted upstream, and creates no conformance claim. The current upstream [Iron Law draft](https://github.com/qwerfunch/ironclad/blob/main/iron-law.md) remains authoritative for its 13 stages and four cumulative levels.

## Problem statement

Ironclad's current stage catalog is a useful interoperable execution and reporting surface. A fixed stage list alone cannot express which contract subject was proved, which input bytes were observed, whether the result is current, why a skip was permitted, or whether independent/human evidence was actually verified. Extensions also need a way to add checks without renumbering the standard or presenting a tool-specific count as Ironclad itself.

This RFC proposes an additive semantic layer:

```text
compiled contract
  → profile-selected obligations
  → stage and extension adapters
  → normalized observations
  → freshness and failure reduction
  → profile verdict and attestation
```

The proposal preserves every existing standard stage ID and L1–L4 meaning.

## Compatibility boundary

The standard catalog remains 13 stages:

- L1: `stage_1.1` Type, `stage_1.2` Lint, `stage_1.3` Drift, `stage_1.4` Commit, `stage_1.5` Arch, `stage_1.6` Secret;
- L2: `stage_2.1` Unit, `stage_2.2` Coverage;
- L3: `stage_3.1` Smoke, `stage_3.2` Performance, `stage_3.3` Visual;
- L4: `stage_4.1` Audit, `stage_4.2` UAT.

An implementation that supports only the existing catalog and cumulative rule remains interpretable. The obligation model adds subject, closure, provenance, and freshness semantics; it does not delete, rename, or reorder a stage. Legacy scalar stage results can be imported as observations with the narrowest honestly known subject and an explicit `legacy` precision marker. Missing subject precision is not fabricated.

## Extension registry

Extensions use a namespaced identity rather than claiming a new standard stage:

```yaml
extensions:
  - id: cladding.spec-conformance
    compatibility_alias: stage_2.3
    claim: contract_behavior
    environment: isolated_runtime
  - id: cladding.deliverable-smoke
    compatibility_alias: stage_2.4
    claim: deliverable_runtime
    environment: declared_runtime
```

An extension registration declares:

- stable namespaced ID and version;
- human label and optional legacy/tool alias;
- claim and valid subject kinds;
- required input-closure rule;
- accepted observation channels and environment class;
- deterministic, side-effecting, network, and human requirements;
- N/A rule and default blocking policy;
- adapter/tool identity used to execute it.

Adding an extension does not change the 13-stage count or silently raise an Ironclad level. A profile may require extensions and reports them alongside, not inside, its derived standard level.

## Core records

### Obligation

```ts
interface IroncladObligationProposal {
  id: string;
  subject: string;
  claim: string;
  closure_sha256: string;
  accepted_channels: readonly string[];
  environment: string;
  required: boolean;
  blocking: 'hard' | 'report';
  source: {kind: 'ironclad-stage' | 'extension'; id: string};
}
```

The obligation is derived from the current compiled contract and selected profile. It is not authored as a duplicate requirement. `subject` is an address such as project, feature, criterion, artifact, or deliverable. `closure_sha256` covers every contract, implementation, verification, policy, and evidence input relevant to the claim. `blocking` expresses the selected profile's effective policy; a tool that hardens a standard reporting stage records that policy separately from the source stage's strictness rather than rewriting the standard.

### Observation

```ts
interface IroncladObservationProposal {
  obligation: string;
  subject: string;
  closure_sha256: string;
  outcome: 'passed' | 'failed' | 'unobserved' | 'not_applicable';
  reason?: 'skipped' | 'timeout' | 'pending_env' | 'unsupported' | 'stale' | 'cancelled';
  provenance: 'authored' | 'derived' | 'observed';
  channel: string;
  tool: {id: string; version?: string; config_sha256: string};
  environment_sha256?: string;
  evidence?: readonly string[];
  observed_at: string;
}
```

These proposal-scoped records are a simplified upstream projection, not aliases of Cladding's internal D21 types or a promised wire format. A declared test binding is authored provenance. A matching case-level runner result is observed provenance. They may join but never collapse into the same fact. A result is reusable only when its subject and complete closure still match.

## Profiles and cumulative levels

An assurance profile selects required obligations and its maximum claimed Ironclad level. L1–L4 remain cumulative: level N requires every hard standard obligation through N to pass and every reporting obligation to report an explicit `pass | fail | n/a`. A reporting failure completes the standard reporting requirement but remains visible; a tool profile may explicitly harden it. Tool extensions are evaluated separately.

A proposed tool default may be L2, matching the current prototype-level boundary, while project or risk policy selects L1, L3, or L4. A tool must report the selected profile, derived standard level, required extension set, and unresolved obligations. It must not call an extension pass “L3” or “L4” unless the corresponding standard obligations are also complete.

## No-vacuous-GREEN reduction

A profile is GREEN only when all of the following hold:

1. every required obligation has an observation bound to the same subject and current closure;
2. at least one accepted observed channel establishes each required behavioral claim;
3. an explicit failure in any declared applicable channel dominates positive evidence for that obligation, after which its effective `hard | report` policy decides profile blocking;
4. skipped-only, absent, stale, or unknown observations do not satisfy a required obligation;
5. N/A is accepted only under the obligation's declared policy rule;
6. a passing unrelated test, same-file result, sibling subject, or other project cannot transfer proof;
7. reporting metrics such as coverage cannot substitute for a missing behavioral observation unless a profile explicitly defines that distinct claim.

An unknown that needs an unavailable environment, verifier, or human channel should produce an escalation result. A deterministic, locally repairable absence should produce an actionable failure. Neither is GREEN.

## Attestation

An attestation seals one completed profile, not the proposition that every possible check ran. It records:

- profile and policy identities;
- derived Ironclad level;
- required standard and extension obligation IDs;
- normalized successful and N/A observation identities plus compact counts;
- contract, implementation, verification, and evidence closure digests;
- engine, tool, environment, extension-registry, and trust-snapshot identities.

Only a foreground authoritative reduction of the current closure may write an attestation. A background or partial run may cache observations but cannot change lifecycle state or attest. A stronger profile cannot be inferred from a weaker profile's GREEN record.

## Stage 4 receipt semantics

Stage 4 requires more than a workspace-controlled `author: human` string. A qualifying receipt should contain, directly or through signed canonical framing:

```ts
type Stage4Check = 'pass' | 'fail';

interface IroncladStage4ReceiptProposal {
  issuer: string;
  issuer_key_id: string;
  issuer_proof: string;
  subject: string;
  subject_sha256: string;
  claim: 'audit' | 'uat';
  criterion_verdicts: Readonly<Record<string, Stage4Check>>;
  checks: Readonly<Record<string, Stage4Check>>;
  reviewed_inputs_sha256: string;
  runtime_dependency_sha256: string;
  implementation_authors_sha256: string;
  observed_at: string;
}
```

- This is a proposal projection, not the Cladding receipt wire type. The claim-specific outcome is derived from its criterion rows and required named checks rather than persisted as a second verdict fact.
- Audit has one exact composite-criterion row and attests evidence sufficiency, code/test review, and independence for that scope.
- UAT is signed once for a feature but enumerates every current composite criterion's intent-alignment result and attests no surprise plus trade-off acceptance over the full runtime dependency closure.
- An explicit failed row or check dominates. A pass requires the exact applicable criterion set and all required checks; missing rows remain unobserved and unknown addresses invalidate the receipt.
- Signature verification establishes that a registered issuer made the assertion; it does not prove universal human identity or semantic truth.
- Audit compares the verified issuer with the bound implementation-author set. A same-author receipt remains self-certified history and cannot satisfy an obligation that requires independent review.
- Verified blind evidence may establish independent provenance but never substitutes for human UAT.
- A stale subject, implementation, reviewed-input, trust, or signature closure cannot satisfy Stage 4.

## Background execution and host topology

Implementations may speculatively execute deterministic, isolated obligations after edits. Such observations are marked non-authoritative and content-addressed. A foreground reducer may reuse them only after validating the exact current closure, tool configuration, policy, and relevant environment. Speculative work never writes evidence, lifecycle state, canonical generated artifacts, or attestation.

Agent topology is outside the proof rule. A host may use one or many general agents to plan, implement, test, review, or observe. Gate and profile verdicts depend on contract and evidence state, not persona names. Identity enters only where an obligation explicitly requires independent, blind, or human provenance. A blind claim requires an evidenced negative-capability boundary rather than a prompt label.

## Conformance and migration

Adoption is additive:

1. keep current 13 stage IDs and results;
2. register tool-specific checks under namespaced extension IDs;
3. normalize stage outputs into observations without inventing missing subjects or selectors;
4. introduce profiles and profile-complete attestation;
5. tighten required behavioral and Stage 4 claims only when their address, observation, and receipt adapters exist.

During migration, legacy observations may remain visible as `unknown`, `stale`, or imprecise. Compatibility must never turn absence of precision into a pass. Tools may retain old stage aliases in CLI and JSON output while making namespaced identity canonical in the extension registry.

## Claim limits and open questions

This model by itself does not prove lower latency, better correctness, agent adoption, human identity, or semantic requirement quality. Those need separate benchmarks or evidence. In particular, background availability is not background reuse, a pushed result is not agent adoption, and a smaller active-wait time may trade for greater CPU consumption.

Questions for any upstream discussion include:

- whether obligation/observation schemas belong in Ironclad core or an optional protocol;
- which environment identity is sufficient for reusable L3 observations;
- how standard soft/reporting stages interact with tool profiles;
- whether Stage 4 trust roots are standardized or deliberately implementation-defined;
- how extension registry versions enter cross-tool conformance fixtures.

No answer in this draft is an upstream decision until Ironclad's own governance accepts and publishes it.
