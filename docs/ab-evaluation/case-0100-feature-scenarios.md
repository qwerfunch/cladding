<!-- Cladding · ab-evaluation · 0.10.0 feature-scenario battery · 0.9.4 against the 0.10.0 candidate · pre-registered 2026-09-09 -->

# Every 0.10.0 change, checked against the engine it replaces

The previous campaign asked whether the release was better than what came before
it. This one asks a narrower and more awkward question: was every change in it
actually checked? A release note lists twenty changes and a heads-up paragraph
of eight sentences; the campaign that preceded it covered about half of them
directly, and the rest rested on the fact that the work had tests. Tests are the
author's account of their own work. What was missing was an outside one — the
same project, two frozen engines, and a question asked of both.

So each item in the release notes now has one of three things attached to it: a
row in a deterministic table that runs both engines and writes down what each
said, a live probe against a real AI host, or a written reason why a black-box
row would measure nothing. The mapping lives in `scripts/ab-abc/coverage.yaml`
and is checked by this repository's own test suite, so "every change was checked"
fails in CI the day it stops being true rather than the day someone re-reads this
document.

The rows cost nothing to run. Both engines are frozen installs driven directly —
no model, no host, no spending — so the table can be re-run on demand and its
answers are the same every time. The guesses were written down before the first
run, which is what makes a wrong guess a finding rather than an edit.

## Build lineage

Three builds are named in this document, and it matters which is which. The
reference-host cycles and the packed-tarball campaign ran on the build from
`0578818` (`dist/clad.js` sha256 `1bb59b71…`). The version campaign and the host
probes ran on the build from `56f3cb9`, which adds the adopter-guidance repair
F-6349870d (sha256
`a679adcc0c7e2d24190a746a7061625510372b6b6a135ac7d458e0bd01ca0b6b`). The build
that ships is `e32c694` (sha256
`b34e2755e9b9c891c1799545d17bf8c2ad1a891383bc4e93b74f453e58cd9f09`), which adds
F-18a5883a — the two command-line repairs the rows below found. Those repairs
touch only the two command-line paths named under Findings: the tool catalog is
unchanged (still 140,498 bytes and 27 tools), and so is every gate verdict
reached without the one-run assurance-level option.

## Status

**Locked 2026-09-09 — 43 rows, 0 mismatches, negative check passed.** All
twenty-seven new rows have run, every one is classified, and every one is now
pinned: the whole table, the sixteen earlier rows included, is enforced rather
than recorded. The two rows that had found product faults were held back until
F-18a5883a (commit `e32c694`) repaired them; they were re-run on the build that
ships (sha256 `b34e2755…`) and are locked on that repaired run.

Locked means the runner compares every pinned exit code, byte count and literal
against what it just saw and fails on the first difference. The whole table was
re-run against the pins and held, and the lock was checked in the other
direction too: one pinned literal was changed to a wrong value, the row re-run,
and the run failed naming that literal. The host probes ran on 2026-09-09 and
are recorded below.

One row changed shape to be lockable. S-A5's question — the shape a clarify
round trip hands back — needs an onboarding session, and a session needs a host
model, so it cannot be driven here. What can be driven is the refusal that makes
it manual, and the row now runs and pins that on both engines instead of sitting
in the table with nothing enforced. The round-trip question stays with the host
probes.

## Coverage ledger

Each item below is a bold lead from the 0.10.0 release notes, a sentence of its
heads-up paragraph, or a feature entry added since 0.9.4. "Rows" names the
deterministic side-table rows that exercise it; items with no rows carry a
written reason in the ledger itself.

### Release-note items

| Item | Rows | Status |
|---|---|---|
| Spec schema 0.2. | S-A1, S-B1, S-B2, S-B3, S-C2, L0-11 | match: S-B3, S-C2, L0-11 · expectation-wrong: S-A1, S-B1, S-B2 |
| One compiled model now answers the questions that used to be asked of four, | S-E1, S-E2, L3-2 | match: S-E2, L3-2 · expectation-wrong: S-E1 |
| The count sync covers feature counts too. | — | not a scenario |
| `clad relocate-generated` moves the generated files under `spec/generated/`. | S-F1 | match |
| A schema 0.2 workspace explains its own generated files. | S-A4 | match |
| A release gate for the 0.2 validation work. | — | not a scenario |
| The release was measured against the engine it replaces, and against no engine at all. | — | not a scenario |
| Completeness is judged from structure alone. | S-C3, S-C4, S-D6 | match: S-C4, S-D6 · defect-fixed: S-C3 |
| The authoritative profiles block on warnings. | S-C1, S-B6, L0-1 | match: S-C1, S-B6 · defect-fixed: L0-1 |
| A project's own instructions now say how a test claims a criterion. | S-A1, S-A3, L0-2 | match: S-A3, L0-2 · expectation-wrong: S-A1 |
| An archived feature whose successor is not done yet | S-B6 | match |
| `clad done` reports how independently the work was verified. | S-D4, L0-6, L0-6b | match: S-D4, L0-6b · designed: L0-6 |
| The experimental headless loop and its `run` command. | S-G1 | expectation-wrong |
| The parts that existed only to serve that loop: | S-G1 | expectation-wrong |
| The `run` skill, | S-G1 | expectation-wrong |
| The host support table was refreshed against live runs for this release. | live host probe | probed 2026-09-09 — three hosts pass, Antigravity fail (host wiring) |
| Graph code no longer reaches into gate code, | — | not a scenario |
| A renamed test keeps its binding. | L0-11, S-F2 | match: L0-11 · expectation-wrong: S-F2 |
| Patched dependencies. | — | not a scenario |
| A workspace holding a signed review could never record a verification. | S-D2, S-D3 | match: S-D2 · designed: S-D3 |
| Asking for a different level of assurance for one run now says why it was refused. | S-C3 | defect-fixed |
| A receipt imported on the command line is now checked against the project's registered signers, | S-D5 | defect-fixed |
| An attestation stamped on a working machine now matches the one a clean checkout computes. | S-C5 | pending — pre-registered, runs in the repack round |

### Heads-up sentences

| Item | Rows | Status |
|---|---|---|
| the migration refuses to touch a path with uncommitted changes on it | L0-11, S-F2 | match: L0-11 · expectation-wrong: S-F2 |
| One of those decisions asks whether your already-completed features may carry their existing proof forward. | L0-11 | match |
| Answer no and they carry nothing | L0-11 | match |
| changing your mind means undoing the migration and applying it again | S-F2 | expectation-wrong |
| The headless loop is gone — start the server with `clad serve` | S-G1 | expectation-wrong |
| Moving the generated files into one folder is opt-in through `clad relocate-generated` | S-F1 | match |
| the pre-push check rewrites the sealed record of what was verified every time it passes | S-C2 | match |
| has to come at the very start of the test's title | L0-2, S-A1, S-A3 | match: L0-2, S-A3 · expectation-wrong: S-A1 |

### Feature entries added since 0.9.4

| Item | Rows | Status |
|---|---|---|
| F-6349870d | S-A1, S-A3 | match: S-A3 · expectation-wrong: S-A1 |
| F-6f0a2106 | S-C1, S-C2, S-C3 | match: S-C1, S-C2 · defect-fixed: S-C3 |
| F-1a87a6bd | — | not a scenario |
| F-0a29d024 | — | not a scenario |
| F-8e7f399b | S-D4 | match |
| F-9fcdd0a0 | S-G1 | expectation-wrong |
| F-f4cfd533 | S-D1, S-D2, S-D5 | match: S-D1, S-D2 · defect-fixed: S-D5 |
| F-b8d77abf | — | not a scenario |
| F-208eaa79 | S-E1, S-E2 | match: S-E2 · expectation-wrong: S-E1 |
| F-c4df5fb4 | S-A1, S-A2 | expectation-wrong: S-A1, S-A2 |
| F-14c9d647 | S-F2 | expectation-wrong |
| F-94285dd8 | S-B5 | match |
| F-2883ff4d | L0-2, L0-9, S-D2, S-D3 | match: L0-2, L0-9, S-D2 · designed: S-D3 |
| F-a0bd9c5a | S-D3 | designed |
| F-c2d7dc78 | — | not a scenario |
| F-0dafcf9d | S-F1 | match |
| F-0b8f23c5 | S-B4 | designed |
| F-2bbecd83 | — | not a scenario |
| F-4f4a12c3 | S-B3, L0-8 | match: S-B3, L0-8 |
| F-2f840a6c | — | not a scenario |
| F-182eaa53 | — | not a scenario |
| F-71da4292 | S-C5 | pending — pre-registered, runs in the repack round |

## Observations

One section per group of rows. Each records what both engines did, what the
pre-registered guess said, and how the difference was classified. "The released
engine" is 0.9.4; "the candidate" is 0.10.0. Both are frozen installs.

### A — onboarding and instructions

- **What each engine's scaffold declares (S-A1).** The released engine sets a
  project up in the old format with no assurance level, no scenario setting and
  no stated purpose, and the instructions it leaves behind never mention how a
  test claims a criterion. The candidate declares the new format, an assurance
  level of L2, the advisory scenario setting and a purpose, and its instructions
  name both the criterion-binding token and the command that opens a cycle.
  **expectation-wrong** — the substance held on both engines; the guess also
  asked about `CLAUDE.md`, and neither engine writes that file when a project is
  set up. It belongs to the adopter, and only the refresh command touches its
  managed section, which is the question the next row asks.
- **Asking for the old format (S-A2).** Both engines produce an old-format
  scaffold. The instruction files and the project declaration differ by a single
  byte each: the example filename in the sentence explaining how to name a spec
  entry file. The managed section the refresh command writes is byte-identical.
  **expectation-wrong** — the guess demanded a zero-byte diff, and the one byte
  is a documentation wording correction carried into the old format, not a
  scaffold that changed shape.
- **Refreshing instructions written before this release (S-A3).** On a project
  whose managed section still carries the old wording, the released engine's
  refresh reports nothing to change and leaves it alone; the candidate's reports
  the section as stale and rewrites it, and the criterion-binding sentence comes
  back with it. **match.**
- **A workspace that explains its own generated files (S-A4).** The candidate's
  workspace carries a note saying which files it generates and where relocation
  would put them, and running the projection twice leaves it byte-identical. The
  released engine produces no such file. **match.**
- **The onboarding question-and-answer round trip (S-A5).** The round trip
  itself is not run here. Driven against a fresh new-format workspace, the
  clarify surface refuses with "no onboarding session": a session only exists
  after a setup run that called the host's model, so driving this without a model
  would mean faking the session rather than exercising the surface. That refusal
  is what the row now runs and pins, on both engines alike. **manual** — the
  round-trip question belongs with the live host probes, where a model is present
  anyway.

### B — writing the spec, and editing it

- **The statement grammar, four ways to get it wrong (S-B1).** The candidate
  refused all four malformed criterion statements and accepted the well-formed
  one. The released engine accepted three of the four and refused the fourth,
  and a control showed that refusal came from the shape label the row attached
  to the sentence rather than from the sentence itself. **expectation-wrong** —
  the refusals are right, but every one of them reads only that the statement is
  invalid, naming neither the rule broken nor the offending words, so the guess's
  "each refusal names a reason" was too generous. A wording candidate for 0.10.x.
- **Claiming completion for work that has not started (S-B2).** The candidate
  refuses a completion on a feature nobody opened, opens cleanly when asked, and
  then refuses again for the missing code and unproven criteria, leaving the
  status alone throughout. The released engine, which has no opening step,
  refuses the first attempt and reverts correctly — and on the second, identical
  attempt its drift stage crashes after the status has already been flipped, so
  the revert never runs and the refused feature is left reading `done`.
  **expectation-wrong** — the candidate's refusal is about state and never names
  the step that was skipped, which is what the guess asked for. The released
  engine's behaviour is the campaign's one comparative safety difference, and is
  recorded under Findings.
- **Two prepared edits from one snapshot (S-B3).** Two edits prepared at the same
  moment against different files both apply; replaying the first from its spent
  snapshot is refused as stale. **match.**
- **A described journey nobody has claimed (S-B4).** Under the default setting an
  unclaimed journey draws one informational finding and the mid-cycle check
  passes; under the stricter setting the same journey becomes an error and the
  check fails. **designed** — the policy answer came out exactly as guessed. The
  label is for the boundary the run recorded beside it: while an unclaimed
  journey file is on disk, the structured editing surface refuses every
  transaction, and under the stricter setting the specification stops loading
  altogether, degrading some twenty unrelated checks to "spec.yaml not loaded".
  Both are the deferred contract item named in the plan, not a discovery here.
- **A capability reference that has to resolve (S-B5).** Naming a capability
  nobody declared is refused at authoring time, so it never reaches disk; after
  the capability is declared, a feature naming it is accepted. **match.**
- **An archived feature whose replacement is not built yet (S-B6).** With code
  still standing behind an archived entry and a named successor not yet done, the
  released engine calls it a warning and the candidate calls it information,
  adding that retirement is the successor's job. **match.**

### C — check profiles and the sealed record

- **The named profiles, and the one that refuses uncommitted work (S-C1).** The
  released engine does not know `--profile` at all. On the candidate the
  completion profile passes and leaves the sealed record modified; `clad check
  --profile release` against that uncommitted tree fails and names the commit
  stage; after committing it passes; and an undefined profile name is refused
  with the list of real ones. **match**, in full.
- **The shape of the sealed record (S-C2).** The released engine writes a
  1.3 KB file with no per-feature row, and a second passing check leaves it
  alone. The candidate writes one row per feature carrying the record's own
  version, the engine that wrote it, a digest of the observations and how many
  there were, with no observations inlined — and a second passing check does
  change the digest. **match**; the rewrite-on-every-pass was in the guess and is
  in the release notes as a heads-up, because it means a green check leaves the
  sealed record showing as a modified file.
- **Asking for a level the run cannot honestly reach (S-C3).** On the first run,
  asking for a higher or a lower level exited 1 with the old four-key report — no
  requested or achieved level, no unmet obligations — and said nothing at all
  about the level. **A product fault, fixed by F-18a5883a (commit `e32c694`),
  re-run on the shipped build `b34e2755…` and locked.** On that build, at the
  level the project already declares the push profile passes and returns its full
  report; asked for a higher level it refuses with "A stronger one-run assurance
  level requires a compiler-proven bounded scope", and for a lower one with
  "Requested assurance level cannot downgrade the persisted project level".
  **defect-fixed.**
- **A feature that declares a module before the module exists (S-C4).** On the
  candidate, a feature under way that declares a file nobody has written yet
  passes the mid-cycle profile with one informational note calling it the normal
  state between writing the spec entry and implementing it. The released engine
  is recorded on the state it can be in — a completed feature — where the same
  shape is two errors and a warning. **match**; the released-engine side is a
  recording, since there is no equivalent in-progress fixture for it.

### D — evidence and independence

- **An issuer key's whole lifetime (S-D1).** Creating a key leaves the private
  half outside the workspace, the key directory readable only by its owner and
  the key file likewise, puts exactly one public entry in the committed registry,
  and refuses a second registration of the same name saying there is no rotation
  path yet. The released engine has no `key` command. **match.**
- **The four ways a verified sign-off is refused (S-D2).** All four refuse: with
  no terminal, with the wrong feature id typed at the prompt, with an
  unregistered issuer, and on the plain asserted path. No receipt file exists
  afterwards, and all four attempts are in the audit history. **match.**
- **A receipt going stale and healing (S-D3).** After a full evidence cycle the
  push profile is green; a committed one-line edit to the module the completed
  feature declares turns six obligations unobserved-and-stale; re-signing
  restores green. **designed** — and the reason the row's own recipe had to be
  corrected first: the edit stales the feature-scoped acceptance receipt as well
  as the per-criterion audit claims, so re-signing only the audit claims leaves
  the gate red. Signing both is what heals it.
- **An independent signer under the strictest policy (S-D4).** With a registered
  issuer whose name is not the committing author's, the cycle completes under the
  policy that demands independence, and the completion reports the work as
  independently reviewed. **match** — with a limit worth stating: independence is
  decided by comparing the issuer's name with the author's name as strings, so a
  second name configured on one person's machine reads as independent. It records
  who signed under which name, not that two people exist.
- **Ingesting a receipt again, tampered, and from a stranger (S-D5).** On the
  first run every ingest succeeded and stored the receipt as asserted evidence
  with the reason "unknown issuer key" — including the control, this workspace's
  own valid receipt signed moments earlier by its own registered issuer — because
  the command-line import never consulted the committed trust registry. **A
  product fault, fixed by F-18a5883a (commit `e32c694`), re-run on the shipped
  build `b34e2755…` and locked.** On that build the control is stored and
  verified offline, ingesting the same receipt again is a genuine no-op, and the
  tampered receipt is refused with an invalid-signature verdict. The stranger's
  receipt is refused too, and the wording is worth writing down: it comes back as
  an expected-digest mismatch rather than as an unknown issuer, because the
  kernel compares the receipt's expected digests before it looks up the issuer —
  and the host tool passes the same context and answers the same way. That is
  parity between the two surfaces, not a gap between them. **defect-fixed.**
- **An evidence census that cannot be read (S-D6).** With a symbolic link planted
  among the receipts, the push profile stops being green, reports itself
  incomplete, names the census as the address it could not settle, and tells the
  reader to remove the link and run the check again — rather than reading the
  unreadable directory as "no receipts, nothing to verify". **match.**
- **A verified sign-off asked for by a client that cannot ask a human (S-D7).**
  Over the tool surface, a client advertising no way to prompt a person gets a
  refusal naming the human step and writes no receipt. The released engine does
  not carry the tool at all. **match.**

### E — the graph

- **The envelope a graph answer arrives in (S-E1).** The candidate answers in the
  second-generation envelope, naming what kind of answer it is, how complete it
  is per layer and how many bytes of payload it carries, well inside the ceiling
  and with nothing required left out; the export prints the same envelope. The
  released engine answers in the first generation and its export names no version
  at all. **expectation-wrong** — two clauses of the guess had no surface to be
  asked on: the export takes `--format json` rather than `--json`, and `clad graph
  stats` prints for a reader on both engines with no machine-readable form, its
  output byte-identical across arms.
- **The blast-radius answer keeps its shape (S-E2).** Both engines answer with the
  same version and the same keys; the candidate adds exactly one. A caller written
  against the released engine still works. **match.**

### F — migration and relocation

- **The generated projections move once, safely (S-F1).** The preview writes
  nothing. The apply moves all three derived files byte-identically, retargets the
  merge line that keeps them from conflicting, and the moved workspace still
  passes its own strict push profile; a second apply changes nothing. Both
  impossible states are refused with a remedy: a file present in both places, and
  an old-format workspace, which is told to migrate first. The released engine
  does not know the command. **match.**
- **The three guards around a migration (S-F2).** Uncommitted work on a path the
  migration plans to touch is refused by name. A baseline decision already applied
  cannot be re-answered — replaying the preview with the answer flipped changes
  nothing and leaves the project declaration byte-identical. A criterion the new
  grammar cannot parse becomes a question the person has to answer, and an apply
  that skips it is refused. **expectation-wrong** — the uncommitted-path refusal
  only fires when the mess precedes the preview. Made afterwards, the same edit
  answers "the input changed since it was read" first, because the preview's
  digest has already moved. Both are honest refusals; the row now runs both orders
  so the two are not mistaken for each other.

### G — retirement and packaging

- **The retired loop is gone from the installed package (S-G1).** On the candidate
  the retired command is absent from the command list, asking for it falls through
  to the general help, the shipped bundle contains neither its description nor its
  driver, and no scaffold mentions it. On the released engine all of those are
  present. **expectation-wrong** — the guess counted files that the published
  package does not have: neither engine ships a skill folder or separate modules
  for the loop, because the tarball inlines everything into one bundle. Searching
  the bundle's own bytes is what "gone from the installed package" means here.

## Findings

**Two product faults, fixed by F-18a5883a (commit `e32c694`), re-run on the
shipped build `b34e2755…` and locked.** Both were in the command-line surface,
and both were found by rows written to ask a question nobody had asked from
outside:

- A one-run assurance level the gate cannot honour is refused **silently**.
  Asking `clad check --profile push` for a level above or below the one the
  project declares exits 1 with the old four-key report and no message about the
  level at all, so the reason never reaches the person who typed it (S-C3).
- The command-line receipt import **never consults the committed trust registry**,
  unlike the same operation asked for by a host. Every receipt is stored as
  asserted evidence with the reason "unknown issuer key" — including a valid one
  signed by the workspace's own registered issuer — so a tampered signature
  cannot be refused there (S-D5).

Both are repaired: asking for a level the project cannot grant now prints the
reason and exits nonzero instead of falling back to the old report with no cause,
and a receipt imported on the command line is checked against the project's
registered signers the same way a host's request is. Both rows re-ran against the
build that ships and are locked on it, classified **defect-fixed**. One detail
from the repaired run is worth keeping: a receipt from an issuer this workspace
does not carry is refused as an expected-digest mismatch rather than as an
unknown issuer, because the kernel compares the expected digests first — and the
host tool answers identically, so the two surfaces agree. Neither fault produced
a false green — the gate re-reads and re-verifies the files itself — but both
left a person worse informed than they should be.

**One comparative safety difference.** On the released engine, a second identical
completion attempt on a feature that cannot be completed crashes its drift stage
after the status has been flipped, so the revert never runs and a refused feature
is left recorded as done (S-B2). The candidate refuses both times and leaves the
status alone. It reproduces byte-for-byte across runs. This is the only place in
the battery where the two engines differ in a way that matters for safety rather
than for wording or shape.

**How the twenty-seven rows came out.** Fifteen matched their pre-registered
guess. Seven were pre-registration errors — the engine's behaviour is defensible
and the guess was not — and each of those carries a corrected expectation beside
the original, saying what was wrong with the guess. Two are deliberate
relaxations named before the fact rather than discovered here. One cannot be
driven without a model and is answered by the live probes instead. And two are
the faults above, awaiting their re-run. Fifteen plus seven plus two plus one
plus two is twenty-seven.

Of the seven wrong guesses, five were wrong about the *surface* rather than the
behaviour — a flag spelled differently, a file the setup step does not write, a
folder the published package does not ship, an order of operations that reaches
a different guard. That is the pre-registration doing its job: had the guesses
been written after the run, none of these would be visible as anything at all.

## Host probes

Four hosts, each driven from a real console with the cheapest model that host
offers, over a finished project the engine set up: three read-only cells (list
the features, read one feature back, run the check) and one write cell (create a
feature, open it, read it back). All four ran on 2026-09-09 against the
`a679adcc…` build. The raw transcripts and the exact command line for every cell
are kept outside this repository, under `~/abc-0100/host-probe/`, because they
carry account and machine detail; what follows is the summary.

| Host | Version | Model | Read cells (3) | Write cell | Tokens / cost | Verdict |
|---|---|---|---|---|---|---|
| Claude Code | 2.1.266 | `claude-haiku-4-5-20251001` | 3/3 real calls, exit 0, 6–8 s | pass — created a feature, opened it, read it back | $0.107 total, from the host's own report | pass |
| Codex CLI | 0.153.0 | `gpt-5.3-codex-spark`, low reasoning effort | 3/3 real calls; the check reported "0 findings" | pass — created `F-e01d7c1b` and opened it, confirmed in the project's own spec files | 12.2k / 14.3k / 7.7k / 14.1k tokens per cell; the host reports no dollar figure | pass |
| Cursor CLI | 2026.07.09 | `auto` (the free plan refuses every named model) | 3/3 pass | pass — created `F-972b67a3`, but only after the fixture's approval list was widened by hand | not recorded | pass, with the caveat below |
| Antigravity CLI | 1.1.27 | `gemini-3.6-flash-low` | fail | fail | — | fail — host wiring, not a verdict about the engine |

Gemini: excluded, superseded by Antigravity (maintainer decision).

**Claude Code.** The write cell first tried to run a shell command, was blocked
by the host's own permission list, and then did the same work through the
cladding tools — which is the behaviour the setup is meant to produce.

**Cursor.** `clad setup` deliberately pre-approves only the three read-only
tools for Cursor command-line sessions; anything that writes needs a person to
approve it in the moment. To measure the write cell at all, the probe widened
that fixture's own approval list. So the readme's "Cursor verified" rests on the
read-only checks, and that is what it should be read as.

**Antigravity.** The failure has two layers, neither of them the engine.

- This machine's shared wiring still pointed at an installation deleted in July.
  `clad setup --host antigravity` refused to replace it without `--force` and
  described it as a non-Cladding configuration, which is wrong — the wiring was
  cladding's own.
- With `--force` the wiring loads and the connection comes up, but the server
  starts outside the project: the host answers that the feature-reading tool is
  not found and shows only the bootstrap tools. The shared wiring carries no
  binding to a working directory, and this host now runs one long-lived
  background process, so nothing tells the server which project it is in. Adding
  the fixture to the host's trusted workspaces did not change it.

With the tools unavailable, the model narrated answers instead — grepping the
files and inventing feature identifiers — and still exited 0. That
false-success shape is worth naming on its own. The remedy for 0.10.x is to take
the workspace from the connection's own declared roots or from a
host-supplied workspace variable, and to recognise a dead cladding launcher as
something replaceable, with a message that says so. The readme's host table is
left unchanged: that table is written only by the doctor run, which drives every
host at its default model.

**Cost.** Dollars are recorded only where the host reports them, which is Claude
Code alone; the others are recorded in tokens and wall time. Every machine
configuration file touched by a probe — the Antigravity wiring and the trusted
workspace settings included — was restored byte-identically afterwards, verified
by hash.

The probes are a read-and-write smoke test, not the full reference-host cycle
two hosts went through for this release.

## Limits

- The deterministic rows compare engines, not developers. A row that finds no
  difference means the two engines answer the same way, not that either answer
  is right.
- Some rows can only be asked of one engine, because the surface they ask about
  does not exist in the other. Those rows record what the older engine says when
  asked — usually that it does not know the command — and that recording is the
  comparison.
- Two fixtures are not always in the same state across arms. Where the older
  engine has no equivalent of a newer state, the row says so rather than
  pretending the inputs matched.
- The host probes depend on accounts, networks and host versions outside this
  repository. A failed probe is recorded as not-run, never as a verdict about the
  engine.
- Cost is only measurable in dollars on one host — Claude Code, from its own
  report. Codex reports tokens but no dollars, so no dollar total is claimed
  across hosts.
- The probes ran on the `a679adcc…` build, not the one that ships. The two repairs in between touch command-line paths the probes never
  take, so the probe results carry over unchanged.
- The Cursor probe could only run on `auto`; the free plan refuses every named
  model, so "cheapest model" is not a comparable setting on that host.
- The Antigravity probe was capped by wall time.
