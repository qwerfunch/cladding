<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — assurance kernel and scheduling

> Canonical owner of D21–D23. This document extends the [Spec 0.2 continuation
> router](../spec-0.2.md). Artifact and compiler ownership remain in
> [D10](model-and-migration.md#d10--artifact-registry-and-compiler-boundary),
> proof and attestation inputs in [D11–D13](proof-and-editing.md), GraphIR
> closures in [D17](graph.md), and task projection and host ownership in
> [D19–D20](context-and-orchestration.md). Dated cadence and invalidation
> measurements live in [Assurance evidence](assurance-evidence.md); the
> [upstream obligation RFC](../ironclad-obligation-rfc.md) is a non-authoritative
> proposal derived from this accepted Cladding design.

## D21 — Iron Law assurance kernel

### Guarantee boundary

The Iron Law is a cumulative set of proof obligations, not a script that runs
every available command after every edit. An obligation names a governed fact,
the inputs that can change it, the observation that can decide it, and the
assurance level and profiles that require it. A stage is a compatibility view
over one or more obligations. Stage numbering never determines execution order,
freshness, scope, or authority.

The kernel is synchronous, deterministic over a sealed input snapshot, and
LLM-free. It may execute project-owned tools and record their observations, but
an agent statement, tool exit alone, or previously present report is not proof
unless a registered adapter resolves it against the current inputs. The kernel
proves that declared obligations received current qualifying observations. It
does not prove unstated intent, universal correctness, or the identity of a
person beyond a verified receipt issuer's signed assertion.

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

Ironclad owns 13 stages; Spec Conformance and Deliverable Smoke are Cladding
extensions. All 15 IDs remain readable in machine output, history, plugins, and
compatibility tests, with labels and aliases derived from the registry. A
profile may require an applicable extension, but its pass never raises the
derived Ironclad level.

Ironclad strictness and Cladding enforcement are separate axes. The standard
marks Coverage and Performance `report` and every other core stage `hard`: a
reporting stage must produce `pass | fail | na`, but its failure does not lower
the derived standard level. Cladding's authoritative profiles deliberately
harden both reporting stages, preserving the shipped rule that a failed check
blocks completion. This tool policy does not redefine Ironclad, and `report` is
never an alias for the shipped blocking `GateStatus.advisory` disposition.

An assurance level requires applicable obligations; it does not invent a
command. Only a compiler proof from current contract and artifact kinds permits
`na`. A missing runner, required adapter, trust key, or observation is
`unobserved`, never `na`, `skip`, or GREEN. Oracle and deliverable policies own
the two extension applicability rules; project-kind rules own Coverage, Smoke,
Performance, and Visual applicability.

### Kernel records

The code-owned `ObligationDescriptor[]` registry is the sole owner of obligation
identity, assurance level, applicability, dependencies, adapters, cache and
resource policy, background eligibility, standard strictness, effective
blocking, and legacy aliases. It complements the artifact registry; neither
copies the other's facts.

```ts
type AssuranceLevel = 'L1' | 'L2' | 'L3' | 'L4';
type StandardStrictness = 'hard' | 'report';
type BlockingPolicy = 'hard' | 'report';
type ObservationState =
  | 'pass'
  | 'fail'
  | 'unobserved'
  | 'na';
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
    state: ObservationState;
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

Independent nodes may run concurrently. The registry declares resource locks
such as `cpu-exclusive`, `network`, `display`, `port`, and `workspace-write`.
Performance runs alone. Mutating, network-dependent, GUI/device, or otherwise
non-repeatable adapters need an explicit environment contract and never become
background-safe merely because their process exits zero.

Architecture and Secret detectors run once; their legacy standalone stages are
aliases over the same observations. A compatible test adapter runs the suite
once while producing case-level results and coverage, then classifies Unit,
Coverage, ordinary test, and oracle channels without re-executing the cases.
When a runner cannot distinguish test failure from coverage-threshold failure,
the adapter may use a second diagnostic execution, but the profile stays
unresolved until attribution is sound. Oracle authoring may require isolation;
oracle execution does not require a second test run.

### Audit, UAT, and blind evidence

Audit ranges over every applicable composite criterion address, never only IDs
already present in an evidence ledger. It is cleared only by a current verified
human Audit receipt for that exact criterion and its required checks. The
receipt must record an applicable pass; a human-authored failure or note remains
evidence history but does not clear Audit.

UAT requires one current verified human feature receipt whose subject, full
runtime-dependency digest, and implementation-author-set digest match the
current feature. Its signed criterion matrix must enumerate every current
composite criterion address. Each passing row clears that criterion's upstream
UAT obligation; a missing row remains unobserved, any explicit failure
dominates, and the receipt's feature checks separately cover no surprise and
trade-off acceptance. This preserves one approval interaction without replacing
the Iron Law's per-criterion UAT meaning with a coarser claim. Criterion-only
receipts, asserted human strings, TTY presence, usernames, hand-written YAML,
and blind receipts never substitute for UAT.

A verified blind receipt contributes independent provenance only when its exact
evidence bytes, capability manifest, subject digest, and a current matching
testcase pass all resolve. It never clears a human-only obligation. Same-author
verification may satisfy behavioral proof but remains `self-certified` unless a
verified independent channel qualifies under project policy. These rules refine
the receipt contract in D20 without making agent count or persona name a gate
input.

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
| `completion` | `clad done`: evaluate the feature as done; run every applicable obligation through the configured level over the feature, observed write scope, co-owners, dependents, and proof closure. | Authoritative for that feature. One invocation only; do not run a duplicate manual push profile immediately before it. Release-only clean-tree and unrelated repository checks defer. |
| `push` | Git pre-push, PR integration, or authoritative CI: compile the integrated change closure and run all applicable obligations through the configured level. Unknown or cross-cutting scope expands to the repository. | Authoritative for integration. Local observations may be reused only by exact trusted digest; CI independently re-executes rather than trusting workspace cache. |
| `release` | Clean committed tree: reproducible build and generated mirrors, repository-wide obligations through the configured level, conformance fixtures, and every release-required adapter. | Strongest authoritative profile. Nothing required may remain unobserved. Performance is isolated; explicit non-applicability remains visible. |

Cheap failure prerequisites run before expensive dependents. The normal order is
compiler/reference failures, required receipt eligibility, static tools,
functional tests, proof reconciliation, smoke/visual, then isolated performance.
This is fail-fast scheduling, not a rule that a positive earlier result can mask
a later failure.

Changed-path scope is sound only when GraphIR can prove the complete owner,
co-owner, prerequisite, dependent, test, oracle, evidence, and configuration
closure. An unknown write scope, unresolved edge, shared compiler/runner config,
lockfile or toolchain change, generated output that mutates after the snapshot,
or adapter whose inputs cannot be enumerated escalates to whole-repository
scope. Unknown never means empty impact.

### Content-addressed invalidation and reuse

Each descriptor declares every byte and policy input that can affect its result.
The cache key includes the normalized obligation and subject addresses, relevant
closure digest, source/test/oracle/config bytes, adapter and tool versions,
detector catalog, trust snapshot, environment class, and explicit missing-file
sentinels. Changing any input invalidates only the dependent observations.

Cache policy is descriptor-owned:

- `same-session` for volatile or environment-sensitive observations;
- `same-commit` for deterministic tools whose complete inputs and environment
  class match;
- `never` for performance, release reproducibility, unsealed external state, and
  any adapter unable to enumerate its inputs.

Caches live under `.cladding/cache/` and are disposable. They never become proof
authority, migrate into the spec, or cross a trust boundary. A cached failure
remains a failure; a cached pass is usable only in a profile that permits its
reuse class. CLI processes may consume a valid cache, but absence or corruption
falls back to execution, never pass.

### Persistent background scheduler

Cladding 0.10 includes a scheduler inside the persistent `clad serve` process.
It has `auto | off` policy under local `.cladding/config.yaml`, defaulting to
`auto`; this operational preference is not a spec fact. `off` disables only
anticipatory work: every explicit checkpoint, completion, push, and release
profile executes the same authoritative kernel. Without a persistent server,
background work is absent and correctness is unchanged.

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

Only adapters marked `background_safe` may run. Such an adapter is offline,
read-only, bounded, killable, isolated from user terminals and shared mutable
services, and explicit about resource locks and outputs. Pure compiler and
in-process detector work is eligible by default. Arbitrary project scripts,
package installation, network access, device/GUI work, performance measurement,
and workspace mutation are not. A project command becomes eligible only through
a reviewed adapter that supplies this isolation contract; it never inherits the
flag from its stage family.

Single-flight applies per workspace, not per client connection. Scheduler
results are content-addressed, so an explicit profile may reuse them without
waiting when its exact snapshot and cache policy match. Explicit authoritative
profiles take priority, cancel or supersede obsolete background work, and never
race it for an attestation write.

The worktree-local cache has a 256 MiB LRU ceiling. Eviction affects latency
only. A same-key foreground request joins the running result and revalidates its
root before use; a different-key request cancels the background adapter. An
adapter without isolated output and cooperative cancellation is foreground-only.

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
2. every effective `hard` obligation has current `pass` or permitted proven
   `na` and no reduced `fail`;
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
class, trust snapshot, and the sorted observation identities that earned GREEN.
It embeds no receipt body and copies no stale observation forward. Feedback,
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
- only a profile-complete completion, push, or release verdict can write v3.
