<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — assurance kernel and scheduling

> D21–D23 owner. [Router](../spec-0.2.md); D10 artifacts/compiler, D11–D13 proof/attestation, D17 closures, D19–D20 task/host. [Assurance evidence](assurance-evidence.md) is dated; [upstream RFC](../ironclad-obligation-rfc.md) non-authoritative.

## D21 — Iron Law assurance kernel

### Guarantee boundary

The Iron Law is cumulative proof obligations, not every command after every edit. Each names a fact, mutable inputs, deciding observation, and required level/profile; stages are compatibility views. Numbering determines neither execution, freshness, scope, nor authority.

The sealed synchronous LLM-free kernel may execute project tools, but agent statements, exit alone, and old reports are proof only through a registered adapter against current inputs. It proves current qualifying declared obligations, not unstated intent, universal correctness, or identity beyond a verified issuer assertion.

### Assurance levels and stage compatibility

Schema 0.2 adds `project.assurance_level: L1 | L2 | L3 | L4`. New 0.2 projects
persist `L2`; migration infers no level from old stage history, proposes `L2`,
and requires explicit operator resolution before apply. Levels are cumulative:

| Level | Required obligation families | Legacy stage view |
|---|---|---|
| `L1` | static and structural integrity | Type `stage_1.1`, Lint `stage_1.2`, Drift `stage_1.3`, Commit `stage_1.4`, Architecture `stage_1.5`, Secret `stage_1.6` |
| `L2` | L1 plus executable test and coverage proof | Unit `stage_2.1`, Coverage `stage_2.2` |
| `L3` | L2 plus system-quality observations | Smoke `stage_3.1`, Performance `stage_3.2`, Visual `stage_3.3` |
| `L4` | L3 plus verified independent human evidence | Audit `stage_4.1`, UAT `stage_4.2` |

Ironclad owns 13 stages; Spec Conformance and Deliverable Smoke are extensions.
All 15 IDs remain readable in output, history, plugins, and compatibility tests;
registry-derived labels/aliases apply. An applicable extension may be required,
but its pass never raises the Ironclad level.

Ironclad strictness and Cladding enforcement are separate. The standard marks Coverage and Performance `report`, all other core stages `hard`; report must produce `pass | fail | na` but a failure does not lower the standard level. Cladding hardens both reporting stages for its authoritative profiles, so failure blocks completion; `report` is never `GateStatus.advisory`.

An assurance level requires applicable obligations, never a command. Only current compiler proof permits `na`; a missing runner, adapter, trust key, or observation is `unobserved`, never `na`, `skip`, or GREEN. Oracle/deliverable policy own extension applicability; project-kind rules own Coverage, Smoke, Performance, and Visual.

### Kernel records

The code-owned `ObligationDescriptor[]` registry is the sole owner of obligation
identity, assurance level, profile membership, applicability, dependencies, adapters, cache and
resource policy, background eligibility, standard strictness, effective
blocking, and legacy aliases. It complements the artifact registry; neither
copies the other's facts.

`CriterionObservationRule[]` owns exact criterion applicability: mode, adapter,
sorted byte inputs, manifest, predicate—not prose, kind, test absence, or
caller `na`. It precedes stages: behavior stays required; static
Unit/Coverage is `na` only for a current passing seal and true predicate;
otherwise unobserved or RED, never GraphIR state.

Compile one scope row for each Unit/Coverage family in addition to criterion rows. Each applicable required row needs a current pass; compiler-proven non-applicability is `na`. A baseline-backed family is never GREEN on fail, skip, missing, or stale. A scope pass permits baseline resolution but never becomes `pass`.

```ts
type AssuranceLevel = 'L1' | 'L2' | 'L3' | 'L4';
type StandardStrictness = 'hard' | 'report';
type BlockingPolicy = 'hard' | 'report';
type ObservationState =
  | 'pass'
  | 'fail'
  | 'unobserved'
  | 'na';
type ResultState = ObservationState | 'migration_baseline';
type UnobservedReason =
  | 'skipped'
  | 'timeout'
  | 'pending_env'
  | 'unsupported'
  | 'stale'
  | 'cancelled';

interface ProofObligation {
  id: string;
  subject: string; // project, feature, criterion, artifact, or anchor address
  assurance_level: AssuranceLevel;
  descriptor: string;
  input_addresses: readonly string[];
  applicability: 'required' | 'na' | 'unresolved';
  source_strictness?: StandardStrictness;
  blocking: BlockingPolicy;
}

interface Observation {
  obligation: string;
  subject: string;
  state: ObservationState;
  input_sha256: string;
  adapter: {id: string; version: string};
  provenance: 'authored' | 'derived' | 'observed';
  assurance: 'asserted' | 'verified';
  reason?: UnobservedReason;
  locator?: string;
  observed_at: string;
  environment_class: string;
}

interface MigrationBaselineResult {
  state: 'migration_baseline';
  baseline_receipt_sha256: string;
  resolution_sha256: string;
  criterion_authorization_sha256: string;
}

interface AssuranceProfile {
  id: 'feedback' | 'checkpoint' | 'completion' | 'push' | 'release';
  assurance_level: AssuranceLevel;
  scope: 'changed' | 'feature' | 'integration' | 'repository';
  obligations: readonly string[];
  authoritative: boolean;
}

interface AssuranceVerdict {
  profile: AssuranceProfile['id'];
  assurance_level: AssuranceLevel;
  scope_sha256: string;
  input_sha256: string;
  state: 'green' | 'red' | 'unresolved';
  profile_complete: boolean;
  results: readonly {
    obligation: string;
    subject: string;
    state: ResultState;
    migration_baseline?: MigrationBaselineResult;
    source_strictness?: StandardStrictness;
    blocking: BlockingPolicy;
  }[];
  independence: 'independent' | 'self-certified' | 'not-applicable';
}
```

Public JSON may add versioned fields around these records, but no consumer may
reconstruct obligation joins, applicability, or freshness from stage labels.
`contractClosure`, `subjectClosure`, and `verificationClosure` remain the single
implementations that supply their respective addresses and digests.

`migration_baseline` is a compiler/migration resolution, never an `Observation`, `pass`, `na`, verified provenance, or historic evidence. It has no observation identity, carries the content-addressed baseline receipt, resolution, and criterion-authorization identities above, and resolves only L2 Unit/Coverage criterion rows.

### Failure, freshness, and provenance

- `fail` means a current adapter observed an explicit negative result. It wins
  channel reduction; effective `blocking` then decides whether the profile is
  RED.
- A `report` obligation is complete with current `pass`, `fail`, or proven `na`;
  its failure stays visible. `unobserved` never satisfies reporting.
- `unobserved` means the obligation applies but no current qualifying
  observation exists. Its reason preserves whether work was skipped, timed out,
  pending an environment, unsupported, stale, or cancelled. Every reason blocks
  an authoritative profile that requires the obligation.
- `na` requires a current compiler-owned applicability proof. Empty ledgers,
  missing config, absent binaries, and unknown scope are never evidence of
  non-applicability.
- A current explicit failure always dominates. Baseline eligibility is the exact unchanged authorization plus no current exact proof mechanism; a live binding, reviewed/legacy exact selector (including skipped, absent, stale, or unsafe), or current static criterion rule is final for that snapshot. Path-only historic refs are not executable proof; unrelated same-file passes and global stage fan-out remain forbidden.
- Authored bindings, derived joins, and observed results retain distinct
  provenance. `asserted` history cannot become `verified` through copying,
  migration, a Boolean flag, or an agent identity string.
- A report is reusable only when its adapter and complete declared input digest
  match. Presence, path, timestamp, git revision alone, or a successful process
  exit is insufficient.

### Stage adapter DAG

One sealed snapshot feeds a dependency graph:

```text
compile canonical inputs and GraphIR once
├─ applicability, references, lifecycle, ownership, and receipt eligibility
├─ Type + Lint
├─ Architecture + Secret
└─ proof execution plan
     └─ one runner observation → Unit + Coverage + test/oracle channels
          └─ post-observation contract/subject/verification reconciliation
               └─ required deliverable/system smoke and visual observations
                    └─ isolated performance observations
                         └─ profile verdict
                              └─ attestation, when profile-complete
```

Independent nodes may run concurrently under registry locks (`cpu-exclusive`, `network`, `display`, `port`, `workspace-write`). Performance runs alone; mutating, network/GUI/device, or non-repeatable adapters need an explicit environment contract and do not become background-safe from exit zero.

Architecture/Secret run once and their legacy stages alias that result. A compatible adapter runs the suite once for cases and coverage, then classifies Unit, Coverage, test, and oracle channels. It may diagnostically rerun unsound failure attribution, but the profile stays unresolved; oracle authoring, not execution, may need isolation.

### Audit, UAT, and blind evidence

Audit ranges over every applicable composite address, cleared only by a current verified human receipt with an applicable pass and its exact required checks; a human failure/note remains history.

UAT needs one current verified feature receipt matching subject, runtime-dependency, and implementation-author-set digests. Its signed matrix enumerates every current composite address: each pass clears that criterion's UAT, a missing row is unobserved, a failure dominates, and feature checks cover no-surprise/trade-off acceptance. Criterion-only receipts, asserted strings, TTY/usernames, hand-written YAML, and blind receipts never substitute.

A blind receipt supplies independence only when its exact bytes, manifest, subject digest, and current matching testcase pass resolve; it never clears a human-only obligation. Same-author proof remains `self-certified` unless a qualifying independent channel exists. D20 does not make agent count/persona a gate input.

## D22 — Profiles, cadence, and background scheduling

### Profile contract

Profiles select obligations and scope, never weaken pass meaning. The configured
`project.assurance_level` is the minimum for completion, push, and release. A
one-run stronger level requires a compiler-proven bounded closure; it neither
changes persisted policy nor waives unobserved evidence.

| Profile | Trigger and minimum safe work | Authority and deferral |
|---|---|---|
| `feedback` | After a canonical spec, source, test, runner-config, or receipt change: compile the changed inputs, classify the write scope, invalidate affected observations, and run relevant background-safe checks. | Advisory and partial. Never writes attestation or changes lifecycle. External scanners, project commands, coverage, and system tests may defer. |
| `checkpoint` | Explicit user/host checkpoint, session Stop, or pre-commit: reconcile the changed closure; run required L1 checks and focused directly affected tests when a runnable proof changed. | Blocking only for the checkpoint consumer. It is not completion and never stamps. Stop may degrade its UI response, but that cannot change obligation state. |
| `completion` | `clad done`: evaluate the feature as done; run every applicable obligation through the configured level over the feature, observed write scope, co-owners, dependents, and proof closure. | Authoritative for that feature. One invocation only; do not run a duplicate manual push profile immediately before it. Commit clean-tree is release-only; unrelated repository checks defer. |
| `push` | Git pre-push, PR integration, or authoritative CI: compile the integrated change closure and run all applicable obligations through the configured level. Unknown or cross-cutting scope expands to the repository. | Authoritative for integration. Local observations may be reused only by exact trusted digest; CI independently re-executes rather than trusting workspace cache. |
| `release` | Clean committed tree: reproducible build and generated mirrors, repository-wide obligations through the configured level, conformance fixtures, and every release-required adapter. | Strongest authoritative profile. Nothing required may remain unobserved. Performance is isolated; explicit non-applicability remains visible. |

Run cheap failures before expensive dependents: compiler/reference, receipt eligibility, static, functional, reconciliation, smoke/visual, isolated performance. Fail-fast never masks a later failure.

Changed scope is sound only with a complete GraphIR owner/co-owner/prerequisite/dependent/test/oracle/evidence/configuration closure. Unknown write scope or edge, shared compiler/runner config, lockfile/toolchain change, post-snapshot generated mutation, or unenumerable adapter input escalates to repository scope; unknown is never empty impact.

### Content-addressed invalidation and reuse

Each descriptor declares every affecting byte/policy input. Its cache key includes normalized obligation/subject, closure, source/test/oracle/config bytes, adapter/tool versions, catalog, trust, environment, and missing-file sentinels; any change invalidates dependents.

Cache policy is descriptor-owned:

- `same-session` for volatile or environment-sensitive observations;
- `same-commit` for deterministic tools whose complete inputs and environment
  class match;
- `never` for performance, release reproducibility, unsealed external state, and
  any adapter unable to enumerate its inputs.

Caches under `.cladding/cache/` are disposable and never proof authority, spec bytes, or cross-trust data. A cached failure remains failure; a pass is usable only in an allowed reuse class. Absent/corrupt cache executes, never passes.

### Persistent background scheduler

Cladding 0.10 schedules in persistent `clad serve`, with local `auto | off` (default `auto`) policy, not a spec fact. `off` disables only anticipation: explicit checkpoint/completion/push/release run the same kernel. Without a server, correctness is unchanged.

In `auto` mode the scheduler:

1. watches canonical compiler inputs and registered proof inputs;
2. coalesces pure compile/in-process feedback after 500 ms of quiet and waits
   for 5 s of edit-idle before starting an external background-safe adapter;
3. runs one snapshot at a time (single-flight);
4. merges invalidations arriving during a run and immediately schedules the next
   snapshot;
5. commits an observation only if its input digest still matches current bytes,
   otherwise retaining it solely as stale diagnostic history; and
6. emits no canonical spec, receipt, lifecycle, attestation, or generated-mirror
   write.

Only `background_safe` adapters run: offline, read-only, bounded, killable, terminal/shared-service-isolated, and explicit about locks/outputs. Pure compiler/in-process detectors qualify by default; arbitrary scripts, install, network, device/GUI, performance, and workspace mutation do not. A project command needs this reviewed adapter contract; stage family never confers it.

Single-flight is per workspace. Exact snapshot/cache-policy foreground work may reuse content-addressed results; authoritative work cancels or supersedes stale background work and never races attestation. The local cache is 256 MiB LRU; same-key foreground joins/revalidates, different-key cancels, and adapters without isolated output/cooperative cancellation are foreground-only.

### Latency targets

| Boundary | Product target | Required timeout result |
|---|---:|---|
| Feedback | p50 ≤ 250 ms, p95 ≤ 750 ms, hard 1 s | advisory `unobserved` |
| Checkpoint | p95 ≤ 10 s, hard 15 s | consumer-visible `unobserved` |
| Completion | soft 60 s, default hard 300 s | blocking `unobserved` |
| Push | soft 5 min, hard 10 min | blocking `unobserved` |
| Release | default hard 15 min or explicit project budget | blocking `unobserved` |

These are acceptance targets, not portable performance claims. A timeout never
becomes pass, skip-green, or compiler-proven `na`.

### Feedback and context

Background execution is a latency optimization, not an agent loop. It dispatches
no model and requires no persona. The host receives at most the current first
blocker, affected business subject, required next proof, deferred-check count,
and observation revision. Identical blocker fingerprints are deduplicated.
`implement`, `verify`, and `observe` packets follow D19: current failures and
freshness are included only when relevant, optional diagnostics remain bounded,
and no background result proves that a fresh agent retained prior context.

## D23 — Verdict, attestation, compatibility, and acceptance

### Profile-complete verdict

An authoritative verdict is GREEN only when:

1. the compiler sealed one input snapshot and complete requested scope;
2. every effective `hard` obligation has current `pass`, permitted proven `na`,
   or the narrow permitted `migration_baseline`, and no reduced `fail`;
3. every effective `report` obligation has current `pass`, `fail`, or permitted
   proven `na`;
4. no required obligation is `unobserved`;
5. evidence meets verified provenance and freshness policy; and
6. the reducer records the exact profile, assurance level, registry, policy,
   scope, input digest, and `profile_complete: true`.

`profile_complete` means all required observations resolved; it is not a
synonym for GREEN. A complete profile may be RED because a hard obligation
failed. Channel failure dominance determines the obligation state before
effective blocking determines the profile state.

`migration_baseline` is explicitly resolved for `profile_complete`, but GREEN permits it only for an unchanged authorized L2 Unit/Coverage criterion with no current exact proof mechanism and passing current scope Unit/Coverage rows. Achieved L2 may count it transparently. It never resolves Oracle, Smoke, Performance, Visual, Audit, UAT, or any L3/L4 obligation.

Warnings and diagnostics may coexist with GREEN only when no obligation maps
them to a required negative state. A stage-count total, process exit aggregate,
clean report directory, or all-skip run cannot establish profile completeness.

### Attestation writer boundary

Attestation v3 is written only from a profile-complete authoritative verdict.
This refines D13's earlier “strict full gate” wording: authority comes from the
declared profile and its complete obligation set, not the `strict` flag or a
numeric stage count. `completion` may attest its exact feature and impact scope;
`push` may attest its integration scope; `release` may attest the repository.
No narrower attestation is rendered as a broader one.

The writer retains private reducer provenance and may mint a row only for a
feature in the compiler's exact effective impact scope at that verdict's exact
input digest; serialized or caller-constructed verdicts carry no such
authority.

The attestation records profile ID, configured and achieved assurance level,
scope and input digests, contract/subject/verification closure digests, current
obligation and adapter registry identities, detector catalog, tool/environment
class, trust snapshot, and sorted identities that earned GREEN. Private run
authority seals baseline identities and requires executed passing scope Unit and
Coverage rows before minting; only current observed required results have
observation identities. It embeds no receipt body and copies no stale observation forward. Feedback,
checkpoint, silent verdict polling, background work, and incomplete profiles
never stamp.

### Compatibility and rollout

- Keep the legacy tier names and all 15 stage IDs readable throughout 0.10.
  Their adapters call the kernel and project its observations; they do not own a
  second execution or reducer path.
- `pre-commit`, `pre-push`, and `all` map to versioned profile aliases. Machine
  output includes both the legacy tier/stage view and the canonical profile,
  obligation, completeness, and assurance fields. `pre-commit`, `pre-push`, and
  `all` alias `checkpoint`, `push`, and `release`; `clad done` calls
  `completion` directly.
- F1–F6 may add the registry, observation model, and adapters behind parity
  fixtures. Old and new blocking results remain identical for 0.1 inputs;
  criterion-addressed and no-vacuous-GREEN enforcement activates with 0.2.
- Default 0.2 authoritative profiles preserve strict completion: Coverage and
  Performance remain `report` in the standard projection but compile as
  effective `hard` obligations for Cladding. No 0.10 project setting weakens
  this policy.
- Schema 0.1 keeps its shipped policy and readable reports. Schema 0.2 writers
  persist `assurance_level`; no inference from old stage history silently grants
  L3 or L4.
- Canonical legacy projection maps `migration_baseline` to `unobserved` (fail closed), never pass or `na`; canonical JSON retains it. Soft-Shell may add a nonblocking explanatory note and discloses its count. Release claims say “profile-complete at persisted L2, with current verified, migration-baseline, and NA counts,” never that every criterion has current exact proof.
- Existing report, event, plugin, and audit consumers receive legacy aliases
  from the registry. New consumers use obligations and profiles. The 15 IDs may
  be retired from a future public default only through a separate compatibility
  decision; their historical interpretation remains stable.
- The background scheduler ships with the 0.10 assurance kernel, but correctness
  and acceptance fixtures run with both `auto` and `off`. Verdict bytes apart
  from timing/cache diagnostics, requested scope, failure set, freshness, and
  attestation content must be topology- and scheduler-invariant.

### Acceptance and measured baselines

Measurements and their reproduction sources live in [Assurance
evidence](assurance-evidence.md); they are evidence, not portable performance
promises.

Committed fixtures must additionally prove:

- official-13 and legacy-15 projections resolve to one obligation registry;
- `L1`–`L4` are cumulative and new 0.2 persists `L2`;
- report failure completes the standard observation requirement but remains RED
  under Cladding's strict policy; report absence is unresolved in both;
- every failure, missing runner, stale report, unknown scope, and empty ledger
  follows the states above with no vacuous GREEN;
- prior JUnit, coverage, performance, evidence, and receipt artifacts cannot
  satisfy changed inputs;
- Unit/Coverage/oracle observations batch without changing result attribution;
- Audit covers the complete composite-criterion set; one verified current UAT
  receipt contains an exact pass matrix over that same set plus both feature
  checks; and blind evidence never clears UAT;
- focused scope equals repository scope on complete closures and escalates on
  every unknown/control-file negative case;
- `auto` and `off`, one or many host agents, and cold or reusable caches produce
  identical authoritative verdicts and attestation inputs; F9 also proves
  single-flight, resource-lock exclusion, cooperative cancellation, exact-key
  reuse, and rejection of every stale background result; and
- only a profile-complete completion, push, or release verdict can write v3; and
- migration-baseline cases cover accept/reject, in-progress F7 exclusion, new/intent-edited criteria, forged/swapped/digest-mismatched authorization, no historic-stage inference, exact live/reviewed/legacy/static-rule precedence (pass/fail/skip/absent/stale/unsafe), path-only eligibility, scope Unit/Coverage failure or skip, L3/L4 non-effect, v3 counts/identities/authority, and compatibility that never pass-launders.
