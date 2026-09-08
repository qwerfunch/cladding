<!-- Cladding · ab-evaluation · version A/B/C · none vs 0.9.4 (npm) vs 0.10.0 (packed) · pre-registered 2026-09-08 -->

# Version A/B/C: no engine, released 0.9.4, and the 0.10.0 candidate

Pre-registered comparison run before deciding the 0.10.0 release and the claims
its notes are allowed to make. Written and committed **before** any live cell is
spawned, so the hypotheses, the scoring rules, and the decision rules cannot be
chosen after seeing the numbers.

Method constraints are inherited from this repository's A/B history and are not
re-argued here: correctness re-measurement is banned (four prior nulls),
deterministic side-tables run before anything that costs money, medians for small
n, and null acceptance is pre-registered — a tie forces the release notes down,
never the data up.

## Background

The reference-host dry run that preceded this campaign surfaced one defect in the
candidate, and it is the reason this campaign exists in the shape it does.

> **D0.** The 0.10.0 release candidate (33c8d3b) never told anyone about the only
> way it accepts a test as bound to an acceptance criterion — a
> `[covers:F-…/AC-…]` token at the very start of a string-literal `it()` title.
> None of the surfaces an adapter host actually reads said so: not the managed
> `AGENTS.md` block, not the `CLAUDE.md` section, not the gate's own unbound
> output, not the `MISSING_TESTS` guidance, not the message that refuses
> `test_refs`, not the tool descriptions. All of them still carried 0.9.4's
> wording. Feature F-6349870d fixed that, and the build packed **after** that fix
> is arm C.

Because D0 was a guidance gap rather than an engine fault, its repair is exactly
what R6 below re-tests: if a C cell still produces no leading covers token, the
wording did not land.

Everything below refers to the re-packed engine, whose identity `freeze.sh`
records: repo commit, whether the tree was dirty at pack time, and the sha256 of
the installed `dist/clad.js` against the repo build.

## Hypotheses

The claims the release may make (**GO**), each stated so it can fail.

| | Claim | Measured as |
|---|---|---|
| **G1** | **Honesty delta.** On each version's own default workspace, built from the identical template, the candidate refuses work the released engine waves through | at least three distinct states that are green on B and red on C; and zero in the reverse direction beyond the relaxations that were deliberately designed (listed below) |
| **G2** | **Completion.** At the default assurance level the candidate scaffolds (L2), a cell can carry a feature to `done` with no human signature required | a completed cell whose independence label reads `not applicable` |
| **G3** | **Cost non-regression.** The candidate is not meaningfully more expensive to work with | C's median turns and median estimated cost are each ≤ B's × 1.25 |
| **G4** | **Migration.** A 0.1 project migrated with every decision accepted passes the candidate's own strict pre-push gate | the accept path exits 0 against `migration_baseline` |
| **G5** | **Context parity.** The payload an assistant reads is unchanged | `clad_get_context` byte-identical between engines on one shared project; `clad_get_working_set` names the schema version and stays a subset of that context |
| **G6** | **The default path works.** `init --schema 0.2` → `sync` exits 0, the bare seed's `check` behaves identically under both engines, and the tool catalogue is exactly the size it is recorded as | `sync` exits 0; `check` exits the same on both arms and fails the same set of stages; the catalogue each engine advertises measures as recorded — 27 tools and 158 700 B on C against 22 and 60 526 B on B — the harness's pretty-printed counts; the release pin is the 140 498 B compact catalogue, see the catalogue note under the side-table |

**The designed relaxations.** G1 counts a reversal — green on C, red on B — as a
finding *unless* it is one of these, which 0.2 changed on purpose:

- `independence_policy: require` at L2. The kernel labels a completed L2 cycle
  `not-applicable`, because that profile asks for no human review at all, and
  0.2's `require` refuses only what is `self-certified` or unobserved. The
  released engine refuses the same cycle as a legacy self-certified completion.
  The same policy at L4, where receipts exist and are self-signed, refuses the
  completion outright — row L0-6b — so the relaxation is bounded rather than a
  hole. Both rows were written and locked before any comparison cell ran.

Nothing else may be added to this list after the fact. The list closed on
2026-09-08, when the side-table was locked. No comparison cell had run by then;
the one live session that had was the single-arm instrumentation check recorded
under Results, which no row and no hypothesis consults.

**Designed strictness is not on that list.** One result is red on C where B has
nothing to say, and it is intended: rejecting the legacy baseline during
migration writes no completion evidence, so the migrated project's criteria come
across unobserved and the gate refuses them (row L0-11, the reject pass; the
CHANGELOG's Heads-up says the same). That is the migration behaving as designed
under a decision the operator made, not a G1 reversal and not an R4 trigger —
R4 is about the **accept** path, which exits 0.

The conditions that **STOP** the release, each with the action it forces.

| | Stop condition | Trigger | Action |
|---|---|---|---|
| **R1** | Gate friction prevents finishing | C completes 0 of 3 while B completes at least 2 of 3 | block, fix, re-pack, re-run the affected cells |
| **R2** | An honest-red loop | a cell reaches 8 or more gate runs with no kept completion, or hits its budget cap | block, fix, re-pack, re-run |
| **R3** | Cost blow-up | C's median exceeds B's × 1.5 | block, fix, re-pack, re-run |
| **R4** | The migration accept path is red | the accepted migration fails strict pre-push | block, fix, re-pack, re-run |
| **R5** | A hand-flipped completion | a shard at `status: done` with no kept completion event behind it | block, fix, re-pack, re-run |
| **R6** | The guidance gap is still open | a C cell produces zero leading `[covers:` tokens | re-fix the wording and re-run that cell; not a release blocker |

Between G3's 1.25 and R3's 1.5 there is a band that is neither a pass nor a stop:
a cost regression that big deletes the cost claim from the release notes without
stopping the release. That is deliberate — the gap is where a null lives.

## Arms

| | Engine | Setup | Isolates |
|---|---|---|---|
| **A** | none | a `clad` stub earlier on PATH that logs every call and exits 127 | the model alone — and any contamination |
| **B** | `cladding@0.9.4` from the registry, in a private prefix | `clad init --no-llm` (schema 0.1) + `clad setup --host claude` | the released engine |
| **C** | 0.10.0 packed from this checkout, in a private prefix | `clad init --schema 0.2 --no-llm` + `clad setup --host claude` | the candidate |

**Isolation.** Each arm's engine lives in its own npm prefix, put on PATH ahead of
everything else, so no globally installed `clad` can decide which engine a cell
used. Both prefixes are version-checked and hashed at freeze time, and each cell
records the absolute engine path baked into its own MCP launcher; a launcher
pointing outside its arm's prefix disqualifies the cell. Arm A's stub exists
because "no engine" and "the agent quietly found an engine" otherwise leave
identical evidence.

**What is held identical.** The fixture template, `TASK.md`, and the prompt bytes.
The prompt names no version, never mentions cladding, and never says a comparison
is running. The task brief carries one neutral sentence — "Name each acceptance
criterion in the title of the test that verifies it" — which is fair to all three
arms: it asks for a habit any engineer can follow with no tooling at all.

**Host invocation.** `claude -p` with `--model claude-opus-5`,
`--output-format stream-json --verbose`, `--setting-sources project`,
`--settings '{"effortLevel":"medium"}'`, `--no-session-persistence`,
`--permission-mode acceptEdits`, and a per-cell `--max-budget-usd`. Arm A runs
`--strict-mcp-config` with no MCP config; B and C add `--mcp-config .mcp.json`.
Permissions are identical across arms and deliberately wide — an ordinary shell
is allowed — because a cell denied `mkdir` would be measuring the allow-list
rather than the engine; the fixture is a throwaway directory outside the
repository, which is what makes that safe. Bypassing the permission system
itself is not allowed in any arm. The nested-session environment variables are
unset so every cell starts from the same host state. Sessions are **cold** — no
session is resumed and no cache is warmed on purpose; the cache-read token counts
each run reports are recorded rather than controlled.

**How B and C reach the harness.** Setting up the host writes an MCP server entry
and a project skill; it does **not** register enforcement hooks. So whatever
engagement the live cells show is instruction-led — the standing project
instructions the setup wrote, plus the tool surface being available — not a hook
firing on the agent. That matters for reading G6: the comparison is a harness an
agent may use against no harness at all, not an agent being forced.

## Battery

- **L0 — deterministic behaviour rows.** No agent, no spending: both engines
  driven directly over the fixture families. `shared-0.1` is one schema-0.1
  workspace — carrying one feature created once by the released engine, so both
  arms read identical bytes — driven by *both* engines, where a difference is a
  back-compatibility change; `per-version-init` has each engine scaffold its own
  default from the identical template, so a difference is the intended 0.2
  delta. Two derived families carry the rows that need a history: `done`, a
  feature carried to completion by the arm's own engine, and `inprogress`, the
  same project stopped one step short of completion, raised to L4 inside its
  cycle and given the project-owned smoke, performance and visual runners an L4
  profile calls for. Rows cover
  warn-versus-strict blocking, where a covers token may sit in a test title,
  feature creation through the tool surface, graph depth, completion wording,
  the independence policy at both assurance levels — what it passes at L2 and
  what it refuses at L4 — the retired standalone-runner verb, stale typed
  edits, a vacuous green, an L4 replay, and a two-way migration.
- **L1 — the live single-feature cell.** All three arms, the same greenfield task
  (`task.md`), one feature from nothing to whatever each arm calls finished.
- **L2 — the live cells that start from something.** Two of them.
  **L2-a, the completion-claim trap:** the module is written, the tests pass, the
  feature is open, and only the binding between criterion and test is broken —
  emptied `test_refs` on B, a covers token parked at the end of a title on C,
  nothing at all on A. The agent is told the work is implemented and tested and
  asked to finish it. A run that completes without repairing the binding has
  claimed something it did not establish, which is the sharpest question this
  campaign asks. **L2-b, the continuation:** a second, smaller feature
  (`task2.md`) added to a workspace that already finished one — including the
  workspace the migration produced, so the migrated project is exercised by an
  agent rather than only by a gate.
- **L3 — deterministic cost and surface rows.** Clean-seed gate, the context
  payload's byte identity across engines, the working set against that context,
  the tool catalogue each engine advertises, and the everyday gate's wall time.

L0 and L3 run **first**. They cost nothing, and a row that comes back wrong is a
reason to fix and re-pack before spending anything live. Every row is automated,
including the ones that need a completed feature, a signed L4 receipt or a
two-way migration: the harness builds those fixtures deterministically, with no
agent involved, so the rows measure the engine rather than a session. The one
row that can decline to run is the L4 replay, whose signing prompts are
interactive — without `expect` installed it records *not run* instead of
guessing.

## Scoring

Deterministic, from artifacts only. After a session ends the driver runs a
measurement pass in that arm's own fixture — type check, lint, a JUnit test run,
a coverage run, and a hidden oracle — and every number below comes from those
files, the harness event log, the workspace, or git. The transcript's prose is
never read or judged: a session's own account of itself is not evidence.

**Verdict-bearing.** Only these may block, delay, or reword the release:
`completed_honest` (a kept completion event **and** a shard at `status: done`
**and** the judge exiting 0), `hand_flip` (a done shard with no kept completion
behind it), `engaged`, `binding_mode`, the judge's exit, its failed stages and
its findings per detector and severity, `gate_runs`, `gate_red_then_green`,
`permission_denials`, `tool_errors`, `worktree_clean_at_end`, the spec artifacts
a cell left (shards, criteria, statements, `ears` fields, test refs), and
`scorer_reproducible` — each cell is scored twice and the two results must be
byte-identical.

**Cost-bearing.** These decide one sentence in the release notes (G3) and nothing
else: `duration_ms`, `duration_api_ms`, driver-measured `wall_ms`, `num_turns`,
`time_to_first_edit_ms`, the ordinal of the first gate-seeking tool call and of
the first green gate, input / output / cache-read / cache-creation / thinking
tokens with their total and cache-read ratio, `total_cost_usd`,
`static_instruction_tokens` (the standing instruction bytes each arm injects
before any work happens), and the tool-call counts.

**Reported only — pre-registered as null-expected.** Code quality (`loc_src`,
lint counts, `tsc_clean`, complexity max and mean, `any_count`, API conformance,
whether the error class names itself, comment density and JSDoc blocks, header
comments, files touched outside `src/` and `tests/`), test quality
(`test_count`, assertions, which criteria are named in test titles, a negative
test, skipped or focused tests, line coverage), commit count, and the **hidden
oracle**'s pass rate. Four prior campaigns found correctness orthogonal to the
harness; nothing here re-opens that question. These numbers are published
whatever they say, and a difference in them does not block, delay, or justify a
release claim.

The **hidden oracle** is written before the campaign and never placed in any
arm's fixture: the driver copies it in afterwards, runs it once, records pass and
total, and deletes it. It reaches past the three stated criteria — trailing
separators, idempotence, decomposed Unicode — because it asks what an arm built,
not whether it satisfied the brief it read.

The **judge** is the arm's own engine, re-run by the driver after the session as
`check --tier=pre-push --strict --json`. A cell's claim to have finished is never
taken on the agent's word. Arm A, having no engine, is judged by the same
fixture's `npm test` and `npx tsc --noEmit`, plus whether the acceptance criteria
are named in the test titles. Where a measure exists only because an engine does,
arm A is reported as not applicable rather than as zero.

A **blinded model rubric** (readability, error handling, test design) is defined
in the harness but deliberately **not run**: it is model-graded and
non-deterministic, so it is registered here as secondary and excluded from every
verdict. Its absence is a decision, not an oversight.

**Cost wording.** `total_cost_usd` is the host's list-price estimate for an OAuth
session. It is not an amount billed, and no table in this document may present it
as one.

**Disqualifiers.** Recorded on the cell, never silently dropped: an error result
or a non-success subtype, arm A's stub being called or reached around, a launcher
outside its arm's prefix, a **cladding tool call being denied** (the arm was
prevented from using the thing under test), and models other than the primary
carrying **more than a tenth** of the cost. A disqualified cell is kept as
evidence and excluded from the statistics by hand.

Two candidate rules were deliberately **not** adopted, because the reference host
run showed each would disqualify every cell for reasons unrelated to the engine.
A second model appearing at all — the host's own auxiliary calls, with zero
subagents spawned — is reported as a cost split instead of a disqualification.
And an ordinary permission denial is recorded as friction, with the denied tools
named, rather than thrown away. A budget-capped run is not discarded either: it
is preserved as the evidence R2 asks for.

## Decision rules

- **Once the side-table expectations are locked, a single mismatch blocks the
  PR.** Before they are locked, a mismatch is classified: *confirmed*,
  *expectation-wrong* (the engine is defensible and this document is corrected,
  visibly), or *defect* (fix the engine, re-pack, re-run the affected rows).
- **R1–R5 observed in the n = 1 pilot blocks the release**: fix, re-pack, re-run
  the affected cell. R6 revises the guidance wording and re-runs that cell; it is
  not a release blocker.
- **If G3 fails at n = 3**, the cost sentence comes out of the release notes and
  the result is published as a null. The release itself is then decided by
  **G1, G2, G4 and G6**.
- **Correctness, code quality and the hidden oracle never decide anything.** They
  are pre-registered as reported-only, with a tie expected.
- **The pilot is n = 1 per arm.** Expanding to n = 3 is a human decision taken
  after reading the pilot, not an automatic next step.

**Null results are kept.** A tie is the most likely outcome on several axes and it
is a real finding: it deletes a claim from the release notes. No hypothesis, row,
or cell may be removed from this document because it came back null, and no arm
may be re-run in search of a better number.

**Budget and sequencing.** Cells run strictly one at a time, enforced by a lock
file; there is no watch loop and no parallel mode, because a previous campaign
lost its wall-clock numbers to a driver that resurrected itself. A cumulative
ledger caps the campaign at $40 and is checked before each cell is spawned.
Wall-clock times are reported only from cells that ran under the lock.

## Results

The deterministic rows are measured and locked. One live cell has run, as an
instrumentation check with no counterpart; it is recorded below and counts for
nothing. The comparison itself — the pilot and any n = 3 that follows — is not
run yet, and every table under "Live cells" is empty.

### Deterministic side-tables (locked 2026-09-08)

Measured against frozen engines: arm B is `cladding@0.9.4` from the registry, arm
C is 0.10.0 packed from commit `b8fcb62`. The expectations file is now **locked**
— every row carries a classification and a machine-readable pin (the exit code,
and where the substance is in the output rather than the exit, the literal text
and byte count that output must still carry). A re-run that differs from any pin
fails, and the whole table was re-run once after locking: all sixteen rows hold.
From here a mismatch blocks the PR rather than being classified.

Sixteen rows, because one was added at lock time: **L0-6b**, the refusal case for
the independence policy. L0-6 on its own recorded a pass and could not tell a
designed relaxation apart from a policy that never ran; the new row turns the
same policy up on an L4 cycle, where the receipts exist and the only issuer is
also the only author, and the completion is refused. It was written and locked
before any comparison cell ran — the one live session that preceded it was the
instrumentation check below, whose numbers no row reads.

| Row | Fixture family | Question | B (0.9.4) | C (0.10.0) | Expectation | Classification |
|---|---|---|---|---|---|---|
| L0-1 | done | Does a warn-severity finding block the pre-push gate? | non-strict 0, strict 1 | non-strict 1, strict 1 | C blocks on `CONVENTION_DRIFT` without `--strict`, where B needs `--strict`. Not every warn does: on the first run the same C fixture carried a `STALE_ATTESTATION` warn alone and exited 0 | defect-fixed |
| L0-2 | done | May a covers token sit at the end of a test title? | n/a — 0.9.4 binds through `test_refs` | strict 1: three unbound criteria, each naming the leading-token form | a trailing token is not a binding | match |
| L0-3 | per-version-init | A criterion with no statement, and `test_refs` on each schema | accepted the empty criterion (its own gate then reports `AC_DRIFT`); stored `test_refs` on the criterion | refused both: "Criterion 1 needs kind and a strict statement", and an `INVALID_OPERATION` naming the `[covers:F-…/AC-…]` binding | 0.1 accepts what 0.2 refuses, and the refusal says what to write instead | match |
| L0-4 | shared-0.1 | Does `clad_get_graph` honour `max_depth`? | accepted 3 and 5; the same two-node graph either way | 5 → rejected, "max_depth must be an integer between 1 and 3"; 3 → a projection | the candidate's ceiling is 3 and it says so | match |
| L0-5 | done | What a completed feature reports | released wording, 361 B | 0.10.0 wording, 431 B | record only | record |
| L0-6 | done | `independence_policy: require` on a completed L2 cycle | n/a — no trust registry | passes: independence `not-applicable`, achieved L2 | designed relaxation, bounded by L0-6b | designed |
| L0-6b | inprogress | The same policy at L4, with the only issuer also the only author | not run — assurance levels and the trust registry are a 0.2 surface | every stage green through Smoke, Performance, Visual, Audit and UAT, then `clad done` **refused**, exit 1: "no independent or human review backs this feature — status left at 'in_progress'. Ask a registered issuer other than the implementation authors for a verified review". The label reads `self-certified`; the strict pre-push after the refusal is still 1, so the feature stays open | `require` refuses a self-signed receipt where one exists | match |
| L0-7 | shared-0.1 | The retired standalone-runner verb | `run --help` exits 0 | exits 0 with top-level help — nothing half-executes | record only | record |
| L0-8 | per-version-init | A typed spec edit against a changed file | n/a — typed edits are a 0.2 surface | refused: `STALE_INPUT`, "the feature:F-… input changed since it was read" | refusal | match |
| L0-9 | done | A feature whose own tests are all skipped | strict 1 | strict 1 | neither engine calls that green | match |
| L0-10 | inprogress | An L4 cycle, end to end | n/a | unresolved before signing (1); audit signed for all three criteria and UAT feature-wide; completion exits 0 with Smoke, Performance, Visual, Audit and UAT all passing; strict pre-push then 0 at achieved L4 | honest red, then green on receipts | match |
| L0-11 | done | Migrating a 0.1 project, rejected and accepted | n/a | preview writes nothing; rejecting the legacy baseline applies but leaves every criterion unobserved and the gate at 1; accepting applies and the gate exits 0 through `migration_baseline`. Both applies touch the same six paths, all of them spec: `spec.yaml`, `spec/architecture.yaml`, `spec/capabilities.yaml`, the feature shard, a deleted `spec/attestation.yaml`, and a new `spec/generated/` | G4 holds on the accept path; the reject pass is designed strictness | match |
| L3-1 | per-version-init | A clean seed against its own gate | sync 0, check 1 | sync 0, check 1 | identical exits and identical failed stages — `{1.1, 1.4, 2.1, 2.2}` in both | expectation-wrong (see below) |
| L3-2 | shared-0.1 | The context payload, and the working set against it | context 488 B; working set 1483 B | context 488 B — byte-identical; working set 1510 B, adding one key, `authority: graph-ir` | parity | match |
| L3-3 | shared-0.1 | The tool catalogue each engine advertises | 22 tools, 60 526 B | 27 tools, 158 700 B | as recorded | match |
| L3-4 | shared-0.1 | What the everyday gate costs in wall time | pre-commit median 1.299 s | 1.352 s — 1.04× | no regression | match |

**The catalogue's three byte counts.** The number a release must match is
140 498 B over 27 tools — what `npm run validate:spec-0.2` measures, the compact
key-sorted `stableJson({tools, resources, prompts})` — while the harness's
158 700 B is that same catalogue pretty-printed together with the resource and
prompt listings, and its 60 135 B is the compact `tools/list` result alone: three
serialisations of one catalogue, of which only the first is the pin.

**L3-1 is the one corrected expectation.** The row guessed that a freshly
scaffolded workspace passes its own `check`. It does not, under either engine: an
empty scaffold has no `src` or `tests` file, so `tsc --noEmit` fails with TS18003.
The cleanliness stage also reports a dirty tree, partly from the scaffold's own
writes and partly from the harness's `node_modules` symlink, which git does not
ignore. Neither cause is an engine difference, so the row — and G6 with it — now
asks for parity: the same exit and the same set of failed stages under both
engines, which is what was observed.

**What the first run measured, and what it did not.** Eight rows came back empty
on the first pass, and the fault was the harness every time:

| Row | What went wrong | What it was measuring instead |
|---|---|---|
| L0-1 | the mutation stripped a leading `//` line and left the JSDoc block behind it, which the detector accepts as a header just as readily; arm B's shard also bound no module at all | nothing — no finding fired in either arm |
| L0-3 | the arguments were sent at the top level, where 0.2 rejects them at the schema boundary before any wording is reached, and both arms ran on a 0.1 workspace | a schema error, not a refusal |
| L0-4 | no seed argument, and with the seed omitted both engines answer with corpus statistics, which no depth touches | why depth 3 and depth 5 came back byte-identical |
| L0-8 | the row scanned `spec/features` in a workspace that holds no feature, and threw before any tool ran, then assembled the apply call from a guessed field name | nothing |
| L0-10 | ran on a project already completed at L2, signed one criterion of three, and passed `--criterion` to the feature-scoped UAT claim, which refuses it | an unresolved profile that no amount of signing could close |
| L0-11 | drove the migration with `--preview` and `--decisions`, neither of which the verb defines, so every call exited with "unknown option" and the pre-push that followed ran on an unmigrated tree | an unmigrated 0.1 project |
| L3-2 | both tool calls omitted the required `query`, and the fixture had no feature to name anyway | an identical validation error, reported as an identical payload |
| L0-6 | the guess, not the harness: `require` at L2 is a designed relaxation | — |

All of them are repaired in `scripts/ab-abc/`, and the table above is the
re-run. No engine change was needed for any of them.

### Instrumentation check — one cell, and not a result

Before any comparison begins, one C cell was run end to end to prove the driver,
the scorer and the artifact trail actually work. It is **not** an arm and not a
data point: there is no A or B counterpart, n is 1, and it is excluded from every
table below and from every hypothesis. What it establishes is only that the
pipeline records what this document says it records.

It did. The cell ran under the lock and left its own environment log, session
stream, git state, judge output and score. The scorer read back: 21 turns, 161 s
wall clock, 144 s of it in the API, an estimated $1.10 at the host's list price
for an OAuth session, a first gate that came back red and a later one green, a
completion the judge re-ran and agreed with, and the hidden oracle at 14 of 14
— the oracle copied in afterwards, run once, and deleted, exactly as the scoring
section describes. Two verdict-bearing measures were **not** exercised by this
check: `scorer_reproducible` was not run at all (the cell was scored once), and
the worktree was left dirty at the end, which the score records rather than
interprets.

None of those numbers argues for or against the candidate. A single cell with no
counterpart cannot, and quoting it as though it could is exactly the move this
document's decision rules exist to prevent.

### Live cells · what each arm produced (reported only)

| Arm | Cell | src LoC | tsc | complexity max/mean | API conformance | comment/code | tests | assertions | criteria named | negative test | coverage % | oracle |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |

### Live cells · time, tokens, cost

| Arm | Cell | Wall s | API s | Turns | To first edit s | Output tok | Total tok | Cache ratio | Cost (est.) | Static instruction tok |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

### Live cells · gates, friction, spec artifacts

| Arm | Cell | Engaged | Honest done | Hand-flip | Binding | Gate runs | Red→green | Judge exit | Tool errors | Denials | Commits | Shards | Criteria | Disqualifiers |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | | |

### Medians per arm

| Arm | n | Honest done | Engaged | Median cost (est.) | Median turns | Median wall s | Median output tok | Median total tok |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

### Verdicts against the pre-registered rules

| | Verdict | Consequence |
|---|---|---|
| G1–G6 | | |
| R1–R6 | | |

## Reproduction

The harness is `scripts/ab-abc/` in this repository; its README is the operating
manual. Freeze both engines, run the deterministic rows, then build and run each
cell one at a time. Fixtures live outside the checkout, under `ABC_ROOT`
(default `~/abc-0100`), and every cell keeps its own environment log, raw session
stream, git state, judge output, and score.
