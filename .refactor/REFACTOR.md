# cladding — refactor program design

**Target:** `develop` @ v0.9.3, baseline commit `23ea6be`. **Executor:** an AI agent working unit by unit.
**Every number in this document was re-measured read-only this session.** Where a survey or an arm was wrong, the measured value is used and the correction is stated.

---

## 1. What we are doing and what we are explicitly NOT doing

We are compacting cladding **in place** — shrinking file contents, deleting provably-dead code, retiring duplicated logic into helpers, and putting the comment corpus under a machine-checked standard — while holding the observable contract (CLI, MCP, hooks, written artifacts, event ledger, gate dispositions) byte-identical, proven by a purpose-built parity harness that is itself mutation-tested before it is trusted. **ARM B won** because it is the only arm whose units already carry commands as their DONE conditions and because it discovered the one oracle nobody else has: `scripts/build.mjs` sets `minify: true` + `legalComments: 'none'` and `src/` contains **zero** `@__PURE__` / `@license` / `@preserve` annotations (verified), so a comment-only change to any of the 182 bundled source files **must** leave `dist/clad.js` byte-identical — turning the riskiest 40% of the work into a SHA-256 comparison. From **ARM C** we graft the parity harness design (freeze-not-mask determinism, alias tables rather than blanket masks, a constructed env, scripted git history, two-level stderr fidelity) and its **KILL CRITERION**: if the harness cannot prove it sees a planted change, the program stops. From **ARM A** we graft the additive-extraction phase — the `measure-extract` shape where a spec-pinned file stays at its path as a thin composition root and its body moves to a new sibling — admitted only *after* the MCP and bundle parity lanes exist, and we relax ARM B's "no new src file" rule accordingly: a new file costs exactly one `modules[]` line in the unit's own new spec entry, and that line is written by a tool, not by hand.

**Explicitly NOT doing.** No file is renamed or moved (422 module paths are pinned by literal path across 275 spec entries, and **no `modules[]` repair writer exists anywhere in the codebase** — verified; only `src/spec/new.ts:310` emits `modules:`, at creation time). No behaviour change of any kind — every wire-visible change belongs to the 0.10.0 program (§8), including the persona-alias removal that all three arms wanted to fold in. No free-form "narrative comment" deletion: comment work is split into four classes and **class 4 is cut from the program** because no oracle in this repo can distinguish a good cut from a deleted decision record. No detector-table rewrite (measured ceiling: 455 lines = 1.3% of `src`, against a file count that is load-bearing in three places). No export hygiene (141 of the 261 unreferenced exports are type-only — types erase — and 106 are test seams already adjudicated in both directions by `tests/code-compact.test.ts:129-149`). No touching `src/graph/viewer/main.ts` (456 measured lines at 0% coverage). No `src/cli/scan/walker.ts` (its entrypoint-first ordering feeds `tests/cli/scan.test.ts`, cited by 32 `test_refs`).

**Honest accounting of what is left behind if Phase 6 is declined (see §10 Q2):** `serve/server.ts` stays 2,030 lines, `cli/clad.ts` stays 1,364, `cli/hook.ts` stays 1,209, the 39 `.cladding` path literals stay across 21 files, and the `drive ↔ ui` directory cycle stays.

---

## 2. The invariants

The contract. Every one must hold **before** a unit starts and **after** it lands. `tools/checkpoint.ts` runs them in this order — cheapest and most diagnostic first, because the failing step index *is* the failure classifier (§7).

| # | invariant | command | expected |
|---|---|---|---|
| **INV-1** | spec↔code map is exact | `npx tsx tools/audit/census.ts --assert` | `entries=<n> modules=422 modules_absent=0 testrefs=243 testrefs_absent=0` |
| **INV-2** | scope was declared | `git diff --name-only HEAD` | ⊆ the unit record's `touch_allowed` |
| **INV-3** | fast tripwires green | `npx vitest run tests/code-compact.test.ts tests/self-consistency.test.ts tests/stages/detector-purity.test.ts tests/stages/interactive-profile-partition.test.ts tests/cli/verb-residue.test.ts tests/cli/gate-golden-matrix.test.ts tests/docs-prune.test.ts tests/plain-render.test.ts tests/terminology-canon.test.ts tests/instruction-led-language.test.ts tests/choreography-guard.test.ts` | exit 0 |
| **INV-4** | types | `npx tsc --noEmit` | exit 0 |
| **INV-4b** | type program is non-vacuous | `npx tsc --noEmit --listFiles \| grep -c '/src/'` | `185` (186 minus `src/graph/viewer/**`) |
| **INV-5** | lint | `npx eslint .` | exit 0, no output |
| **INV-6** | full suite — **never scoped** | `npm test` | `249` files, `0` failed |
| **INV-7** | public test-count claim | `npm run test-count -- --check` | `check passed` |
| **INV-8** | generated mirrors + committed bundle | `npm run build && git diff --exit-code` | exit 0 |
| **INV-9** | conformance | `npm run conformance` | exit 0 |
| **INV-10** | gate (also re-stamps attestation) | `node bin/clad check --tier=pre-push --strict` | GREEN |
| **INV-11** | attestation committed with the code | `git show --stat HEAD \| grep -c spec/attestation.yaml` | `1` on any unit that changed a claimed module |
| **INV-12** | parity | `npx tsx tools/parity/compare.ts --tier=fast` | `IDENTICAL` or every delta matched by a pre-registered `allow.yaml` entry |
| **INV-13** | the harness can still see a change | `npx tsx tools/parity/selftest.ts` | `<N>/<N> REGRESSION` (N grows per lane) |
| **INV-14** | bundle identity for comment-only units | `shasum -a 256 dist/clad.js dist/viewer/app.js` | unchanged from the unit record's `inherits.bundle_sha` |
| **INV-15** | coverage did not fall | `npx vitest run --coverage` | exit 0 against the U-02 floor |
| **INV-16** | manifest honesty | `npx vitest run tests/manifest-honesty.test.ts` | green — `allDetectors.length` == detector file count == `plugin.json` numerator |
| **INV-17** | detector emission order | `npx vitest run tests/detector-order.test.ts` | golden array of 41 names, in order |
| **INV-18** | forbidden paths untouched | `git diff --name-only HEAD \| grep -E '^(src/cli/clad\.ts\|src/spec/(schema\.json\|types\.ts\|validate\.ts)\|src/agents/\|src/graph/viewer/)'` | empty, unless the unit record names the file **and** states why |
| **INV-19** | allowlist did not grow silently | `wc -l < tools/parity/allow.yaml` | equals `inherits.allowlist_entries` unless the unit registered a delta in its own prior commit |

**Forbidden moves, for the whole program, no exceptions.** `src/cli/clad.ts` · `src/spec/schema.json` · `src/spec/types.ts` · `src/spec/validate.ts` · `src/agents/*.md` · `src/graph/viewer/main.ts` · `src/graph/viewer/styles.css` · the 13 `src/stages/*.ts` npm-script targets · `TIER_STAGES` out of `clad.ts` · any non-detector `.ts` inside `src/stages/detectors/`.
Reasons, each verified: `harness-integrity.ts:243-252` parses `clad.ts` as **text** and on a parse miss `return`s with *no finding*, while `scripts/build-plugin.mjs:481-509` uses the identical regex and on a miss only `console.warn`s — the checker and its writer go vacuous together, and `tests/stages/harness-integrity.test.ts:64-70` cannot catch it because it synthesises its own `clad.ts`. `src/spec/schema.json` has three independent hardcoded readers (`scripts/build.mjs:50`, `src/spec/validate.ts:16-18` **at import time**, `src/stages/detectors/meta-integrity.ts:34`) plus 18 claiming entries. `src/stages/detectors/` file count is read by two counters that structurally cannot disagree with each other while `allDetectors` is read by neither (INV-16 closes this).

**Global serialization.** One structural unit in flight at a time — every source-changing commit rewrites the git-tracked 1.5 MB minified `plugins/claude-code/dist/clad.js`, and two structural branches produce a conflict no agent can resolve. Comment-only units are bundle-neutral (INV-14) and may be parallelised; their empty `git diff plugins/claude-code/dist/clad.js` is itself the proof that the commit was comment-only.

**Warranty limits on INV-14, which must be written into the executing agent's brief.** BUNDLE-ID proves *runtime-semantic identity of bundled code*. It is blind to: (a) the **4 live `eslint-disable-next-line` directives** in `src/` (`src/cli/scan/scenarios.ts:35`, `src/cli/scan/dispatcher.ts:131`, `:211`, `src/adapters/sdk/anthropic.ts:102`) — deleting one turns lint red while the bundle stays identical; (b) the 4 src files in no bundle (`src/cli/benchmark.ts`, `src/optimizer/preamble.ts`, `src/optimizer/tail.ts`, `src/spec/cli.ts`); (c) `CONVENTION_DRIFT`, which requires the *first non-empty line* of every declared module to open a comment. All three are caught by INV-5 / INV-6 / INV-10 — but an agent handed "byte-identical bundle ⇒ no side effects" will rationally skip them, so the limits are stated, not implied.

---

## 3. The parity harness (unit 0)

Built as a top-level `tools/` directory. Verified free: `UNMAPPED_ARTIFACT`'s `scanPatterns` emits `src/<layer>/**/*.<ext>` per declared layer, so nothing outside `src/` is scanned; `scripts/test-count.mjs --check` runs **first** in `npm run build` and counts `tests/**/*.test.ts`, so a harness built as vitest suites would block the build on case one; `tsx ^4.19.0` and `yaml` are already devDependencies. `tools/**/*.ts` files **are** claimed in their unit's `modules[]` (one line each) so they inherit `CONVENTION_DRIFT`, `MISSING_IMPLEMENTATION` and attestation coverage.

```
tools/
  checkpoint.ts            runs INV-1..19 in order, prints one PASS/FAIL
  parity/
    normalize.ts           THE single rewrite pipeline — imported by BOTH capture and compare
    capture.ts             materialize fixtures → run case tables → write golden/
    compare.ts             normalize → diff → verdict → exit 0/1
    selftest.ts            apply each mutant, capture+compare, require REGRESSION
    lanes/{cli,mcp,hook,artifact,events,bundle,cleanroom,tty}.ts
    cases/{cli,mcp,hook,artifact}.yaml
    fixtures/  golden/  mutants/  allow.yaml
  audit/
    census.ts              INV-1; also readManifest∩modules overlap, STALE_TESTS headroom
    comments.ts            the machine-checkable half of §4
  spec-remap.ts            --claim <path> --feature <id>   (append one modules[] line)
```

### 3.1 Fixture corpus — five tiers, four already in the repo

| tier | source | drives |
|---|---|---|
| **FX-A `self`** | this repo at the pinned commit, extracted with `git archive` into a temp dir | richest spec (275 entries, 422 paths), all 41 detectors, real toolchain |
| **FX-B `existing-ts`** | copy of `tests/scenarios/_fixtures/sample-existing-ts` — **exclude the committed `.DS_Store`** | `init --scan`, `clarify`, `context`, `impact` |
| **FX-C `seeds`** | the 4 toolchain-less seeds from `tests/scenarios/vacuous-green-seeds.test.ts` | gate dispositions; its header already states the determinism rationale (no toolchain ⇒ 1.1/1.2/2.1/2.2 skip deterministically, no network) |
| **FX-D `greenfield-empty`** | **new** | bare `init`, the uninitialized MCP boundary, hook events with no spec |
| **FX-E `conformance`** | the existing runnable fixtures | captured as exit code + per-fixture verdict table |

### 3.2 What each lane captures

- **CLI** — an **explicit** case table in `cases/cli.yaml` (`{caseId, fixture, argv[], envDelta, mutating}`), never a generated permutation sweep: a generated matrix silently drops a case when a flag is renamed; an explicit table goes RED. Per case: argv, exit code, stdout bytes, stderr bytes, and for mutating cases a post-run sorted `path → sha256` tree manifest. Read-only sweep covers all 28 registrations × their `--json`/`--format` variants and all 28 `<verb> --help`. Exit codes are captured from the spawned process, **never through a shell pipe** — `src/cli/clad.ts:835-840` deliberately sets `process.exitCode` and returns rather than calling `process.exit()`, because `--json` can exceed the 64 KB pipe buffer.
- **MCP** — in-process `Client` + `InMemoryTransport` + `buildServer({cwd})`, the idiom already proven at `tests/serve/description-budget.test.ts:31-35`. Capture `listTools()` (name, title, description **byte-exact**, and the SDK's zod→JSON-Schema serialization — a zod refactor can change the wire schema while the TS type is unchanged), `listResources()`, `listPrompts()`, the `instructions` string, the `capabilities` object, `readResource()` ×3, `getPrompt()` ×7 with and without `featureId`, `callTool()` ×22 on three fixtures **on both success and error branches** capturing the **whole response object** (not just `content[0].text`), the prepare→stage→apply onboarding triple, and the subscribe/unsubscribe `{}` replies. Serialize schemas twice: key-sorted (semantic) and declaration-order (host-observable). *Rationale for the whole-object rule:* measured in `src/serve/server.ts` — 22 `registerTool`, 26 `mcpPayload(`, **49** `type: 'text'` envelopes, **20** `schema_version` occurrences. Roughly half the responses carry neither `structuredContent` nor `schema_version`, so any envelope helper changes ~23 responses and a `listTools()`-only capture is structurally blind to it.
- **Hook** — cases are **sequences** (fresh `.cladding/`, payloads 1..N), because six sidecars persist across invocations. Each sequence runs **twice**: in-process via the exported `runHookEvent()` and as a subprocess via `node bin/clad hook <event> < payload.json`; the two are diffed against each other as well as against the golden. An S↔B divergence is a bundle-entry regression and nothing else produces it. Must include the Stop-hook repeat-fingerprint demotion and `.cladding/stop-block.json` resurfacing on the next SessionStart. Golden includes final sidecar contents with `mtimeMs` masked.
- **Artifact** — after every mutating case, a sorted `path → sha256` manifest of the whole fixture **plus full text** for the ~30 governed paths. `.cladding/` is gitignored, so the manifest is the only way to see it move.
- **Events** — normalized ledger diff **plus** a per-case type histogram. A masked line-diff misses an event that stopped firing when the line count coincidentally matches; the histogram cannot. Assert the 9-member `ImpactSkipReason` enum is exhaustively reachable across the corpus.
- **Bundle (S vs B)** — the entire fast tier run twice: lane S (`npx tsx src/cli/clad.ts`) and lane B (`node bin/clad` with `dist/` freshly built), diffed against each other. `dist/clad.js` is minified with identifier renaming, so byte-diffing the bundle is meaningless; diffing its *behaviour* against source is not. Verified motivation: `__CLADDING_BUNDLED` appears in **17 src files and 0 test files**, and the only real-bundle execution anywhere is CI's `node bin/clad check --tier=pre-commit --strict` — 1 of 28 verbs, 1 of 3 tiers.
- **Clean-room** (per phase, not per unit) — `npm pack` → install into an empty dir → run the fast tier. The only thing that catches a new module falling outside `package.json` `files:` (verified: `["bin/","dist/",".claude-plugin/","plugins/","AGENTS.md",…]` — a new `src/` module reaches users only through the bundle).
- **TTY** — a small in-process lane stubbing `process.stdout.isTTY = true` and capturing writes through a fake stream. `src/ui/pulse.ts:49` gates on `isTTY`, so every piped capture otherwise records only the non-interactive branch — the branch a human never sees. No pty dependency.

### 3.3 Determinism — seven sources, each neutralized deliberately

1. **Wall clock** — 34 `Date.now()`/`new Date(` sites across 18 files; only `bundle` and `doctor-hosts` accept an injected clock. **Use the injection where it exists** so those goldens stay byte-exact; mask the rest as `«TS»`/`«DATE»`. `src/cli/doctor-hosts.ts:632-633` puts the date in the artifact **filename** — mask the path too.
2. **Clock-dependent detector verdicts** — `STALE_EVIDENCE` (90 d) and `STALE_TESTS` (`STALE_DAYS = 30`, verified) change `worst`/`anyFailed`, which is the primary parity signal. **Freeze, do not mask:** `utimesSync` every fixture file to one fixed epoch (making the `STALE_TESTS` delta identically zero) and seed evidence at `captureStart − 1 day`. Then add **one deliberate variant per detector** (a test back-dated 40 d, evidence back-dated 100 d) so the harness proves the detector still *fires*. A normalization that silences a detector everywhere is a harness that cannot see the detector break.
3. **Minted ids** — `src/spec/new.ts` seeds `F-`/`AC-`/`S-` ids from `slug|username|hostname|Date.now()|hrtime`; `src/serve/server.ts:536` mints `APPLY CLADDING <uuid6>`. **Alias table, not blanket mask:** snapshot the pre-run id set; only ids absent from it become `«F1»`/`«AC1»`/`«S1»`. Blanket-masking would erase every cross-reference signal in FX-A. Drive the MCP onboarding lane by echoing back the challenge the server actually returned.
4. **Machine + env** — 8 provider keys select the LLM path purely by presence; `src/stages/toolchain/detect.ts:436` scans the **entire** `process.env`. **Construct** the env: `{PATH, SHELL, TMPDIR}` + `TZ=UTC LANG=C HOME=<fixture>/.home GIT_CONFIG_GLOBAL=<fixture>/.gitconfig`, with the 8 keys explicitly unset. Record the constructed env in the manifest; a golden may never be compared against a capture taken under a different env.
5. **Git state** — `git describe --tags --abbrev=0` is the default `--since` for `changelog`, `report` and `bundle`, so tagging a release mid-program changes their entire output. **Script the history:** `git init`, fixed user, fixed `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, fixed commits, one tag ⇒ SHAs are byte-identical and need no masking. For FX-A pass `--since <pinned sha>` explicitly on every case.
6. **Filesystem ordering** — `src/serve/server.ts:1884-1907` orders `clad_list_features` by shard mtime. The epoch freeze from (2) makes that a stable tie; **verify it empirically in the selftest**, do not assume it.
7. **Stage stderr** — `src/stages/util.ts:76` splices 2,000 chars of raw tsc/eslint/madge/secretlint/vitest output (absolute paths, versions, durations) into `check --json`. **Two levels.** L1, compared strictly: `{stage, label, status, exitCode}` plus the drift stage's full findings array with detector+severity+message+order (those messages are cladding-authored and pinned by `tests/plain-render.test.ts`). L2, compared loosely: `{present, lineCount, firstLineNormalized, lengthBucket}`. Record tool versions in the manifest so an L2 divergence is attributable to a toolchain bump.

**Deterministic by construction — must NOT be normalized.** `spec/index.yaml` (double sort), `spec/attestation.yaml` (sorted modules, `<absent>` sentinel for a missing file), `graph export --format json|mermaid|dot|html` (`src/graph/layout3d.ts:10`: "every coordinate derives from FNV-1a(id); no Math.random / Date"), `oracle` AC sampling, `bundle` with an injected `now`. These five are the highest-signal cases in the corpus; compare them with **zero** normalization and put them in the fast tier.

### 3.4 Comparison and verdicts

Three verdicts. **IDENTICAL** — byte-equal after normalization. **EXPECTED-DELTA** — matches an entry in `tools/parity/allow.yaml`, where each entry carries `{caseId, exact unified-diff hunk (no wildcards), one-line reason, unit id, registered-in-commit}`. **REGRESSION** — everything else, exit 1.

Two further rules, both load-bearing: **a stale allow entry is an error** — if an entry stops matching, the allowance outlived its change and must be deleted, otherwise the allowlist degenerates into blanket suppression, which is the vacuous-green pattern this repo exists to prevent. And **an agent may never add an allow entry to make its own unit pass** (§7 class D).

JSON is canonicalized key-sorted for the semantic diff, with a separate declaration-order fingerprint. **ANSI is not stripped** — `src/ui/pulse.ts:31-46` emits real colour codes and a lost colour is a real regression.

Two tiers: **fast** (~200 cases — CLI read-only, MCP listings, hooks, the five zero-normalization surfaces; target < 90 s) per unit; **full** (~1,200 cases incl. mutating, conformance, bundle S/B) per phase; **clean-room** per phase.

### 3.5 The selftest — the kill criterion

`tools/parity/mutants/` holds deliberate, reverted-after-capture mutations. Seven at minimum, growing by one per lane:

1. change one word in a drift finding message · 2. reorder two keys in an MCP payload · 3. flip one exit code 1→2 · 4. delete one event emission · 5. change one field in `spec/index.yaml` · 6. flip one detector's severity · 7. change one byte of a persona prompt · 8. (hook lane) change one sidecar field name · 9. (bundle lane) break one module's entry guard.

`npx tsx tools/parity/selftest.ts` applies each to a scratch worktree, captures, compares, and requires **REGRESSION for every one**. A mutant returning IDENTICAL names an over-normalization and blocks the unit. The likeliest over-normalizations, in order: (7) stderr fingerprinting, (3) id aliasing, (2) mtime freezing.

> **KILL CRITERION.** If the selftest is not green on all mutants at U-11, **the program ends there**. An unfalsifiable harness is worse than no harness, because it converts "I checked" into "the tool said so". The selftest re-runs at every phase boundary; a failure there means every unit since the last green selftest was verified by a blind oracle and must be reverted (§7 class E).

---

## 4. The comment standard

### 4.1 `src/**/*.ts`

Required, first byte of the file:

```
// Cladding · <area> · <name> — F-<hash>          ← line 1, required
//
// <WHY: the problem, the alternative rejected, or the invariant a
//  future editor must not break>                 ← required, ≥1 line
//
// @see <repo-root-relative path that resolves>   ← optional, 0..n
```

| rule | machine-checkable? | how |
|---|---|---|
| **R1** line 1 matches `^// Cladding · [^·]+ · .+$`, optionally ` — F-<id>` | **yes** | `comments.ts --rule=banner` |
| **R2** the block states a decision / constraint / rejected alternative, never a paraphrase of the signature | **no** — human | only presence is checked |
| **R3** header ≤ **12** lines; ≤ **24** for the 9 named contract modules (`src/spec/types.ts`, `src/stages/types.ts`, `src/adapters/types.ts`, `src/verdict/gate-progress.ts`, `src/stages/detectors/with-spec.ts`, `src/stages/util.ts`, `src/stages/detector-result-cache.ts`, `src/stages/detectors/unmapped-artifact.ts`, `src/stages/detectors/hardcoded-secret.ts`); per-file exemptions listed in `tools/audit/exemptions.yaml` with the unit id that granted them | **yes** | `--rule=header-cap` → `offenders=0 visited=186` |
| **R4** no header restates a feature's acceptance criteria verbatim | **no** — human | |
| **R5a** no count of anything the codebase owns — name the symbol (`allDetectors`) | **yes** | regex + a resolver that knows the true counts |
| **R5b** no `file:line` coordinates — cite the symbol | **yes** | `/\.(ts\|js\|mjs\|md):\d+/`, allow-listing `src/stages/finding-parser.ts` which quotes compiler output as sample data |
| **R5c** no future-release promise ("removed in 0.8"); past-tense provenance ("0.6.0 renamed X to Y") is allowed | **yes** | `/(removed\|lands\|ships\|deprecated) in v?0\.\d/` where the named version ≤ `package.json.version` |
| **R5d** no date as a *time claim* ("as of", "currently", "recently"); a date as a *decision label* ("the 2026-07-06 locale pivot") is allowed | **yes** | ISO date not preceded by a decision-label word |
| **R5e** no unresolvable repo path; no path outside the repo (use a full `https://` URL) | **yes** | filesystem resolve |
| **R5f** no bare SHA / PR number as the sole justification; `(#215)` may follow a stated reason | **yes** | regex |
| **R6** spec ids cited **bare** (`F-9af291fa`), never as `spec/features/F-…​.yaml` | **yes** | resolve against `spec/features/ ∪ spec/scenarios/ ∪ spec.yaml`, with a named allowlist for the 3 illustrative ids (`F-abc123`, `F-a3f9c2`, `F-083`) |
| **R7** all paths repo-root-relative, no leading `./` | **yes** | one convention replacing today's four |
| **R8** JSDoc: every exported symbol gets a one-line summary; `@param`/`@returns` **only** when the meaning is not recoverable from name+type; **`@throws` required** whenever the function can throw; non-exported helpers need no block | **partly** | `jsdoc/require-jsdoc` on exports (R8a); `@param x - <≤3 words containing x>` flagged as restatement (R8b); `@throws` is human |
| **R9** zero `TODO/FIXME/XXX/HACK` — already perfectly observed in 186 files | **yes** | regex |
| **R10** comments in English. The 6 load-bearing Hangul regex literals (`src/router/intent.ts:47,59,66,73,85`; `src/cli/hook.ts:240`) and `src/init/agents-md.ts`'s bilingual EARS example are **inputs**, not prose | **yes** | Hangul outside a string literal |
| **R11** `eslint-disable*` and `@ts-expect-error` are **code, not comments** — never deleted by a comment unit | **yes** | 4 live sites, enumerated in §2 |

**Why R8 codifies the practice and not the aspiration.** Measured: 357 of 373 exported functions (96%) carry a doc block, but only 59 of 341 parameterized ones (17%) carry `@param` — and only 2 of 87 existing `@param` tags restate a name. `docs/code-style.md:33-43` mandates the full field set and is violated 282 times; mass-adding those tags would add ~800 lines of restatement and contradict the same document's Why>What principle.

**Prerequisite, and it is the root cause.** `docs/code-style.md:3` declares itself the SSoT (echoed by `AGENTS.md:38`) while `docs/README.md:14` and `docs/ssot-model.md:63` file it as Tier-C legacy to be deprecated — and its §3 **mandates** `@see ironclad-design/<section>.md` and `@see iron-law.md`, neither of which exists in this repo (verified: `ls docs/ironclad-design` → no such directory; `find . -name iron-law.md -not -path ./node_modules/*` → 0 hits). Those two forms account for **36 of the dangling references** (19 + 17, measured). Until §3 is rewritten, every comment written to the current standard adds a new dangle. U-06 fixes this before any comment unit runs.

**Before / after — src**

```diff
-// Cladding · drift detectors · with-spec
-//
-// Shared spec-loading wrapper. The 11 SPEC-vs-REALITY detectors route
-// through withSpec: ac-drift, convention-drift, deliverable-integrity,
-// doc-reference-integrity, hollow-governance, missing-implementation,
-// project-context-drift, planned-backlog, missing-tests, scenario-coverage,
-// smoke-probe-demand.
-//
-// The 6 WITHIN-SPEC-VALIDITY detectors deliberately do NOT use withSpec …
-// … (38 more lines) …
-// @see iron-law.md stage_1.3
-// @see spec/features/F-084.yaml AC-121
+// Cladding · drift detectors · with-spec — F-9af291fa
+//
+// Load-failure policy for the whole detector layer. A detector that
+// compares SPEC against REALITY must route through withSpec, which
+// downgrades a load failure to `info` — returning [] instead was
+// rejected: it ships a Vacuous Green (the 2026-05 ledger audit found
+// the entire layer info-degrading on a schema-invalid spec, with a
+// full green gate). A detector that validates only WITHIN the spec
+// returns [] silently, because a missing spec is not its finding to
+// make; META_INTEGRITY carries the blocking signal instead.
+// The two rosters are derived by tests/detector-taxonomy.test.ts —
+// do not enumerate them here; the last enumeration drifted 11→21.
```

Header: 47 → 12 lines. R5a (counts) removed, R5e (2 dangling `@see`) removed, R6 satisfied, and the fact that was in the roster is now **derived by a test** (U-05) rather than restated in prose.

### 4.2 `tests/**/*.ts`

Required in **every** file, not only declared modules. This closes a verified structural blind spot: `CONVENTION_DRIFT` walks `features[].modules` only, 99 test files are declared and all 99 have headers, and the 25 headerless files are exactly the 25 that are undeclared.

```
// Cladding · <suite name> — F-<hash>
//
// TEST-AUTHOR context: <impl-blind attestation, or an explicit note that
//   the implementation was read and why>
//
// Sibling ownership: <what this file does NOT duplicate, and where it lives>
//
// AC map:
//   AC-<id> — <one line: what this suite pins for that criterion>
```

| rule | checkable? |
|---|---|
| **T1** line 1 names ≥1 F-id that resolves | **yes** |
| **T2** every `AC-<id>` in the header resolves **and** resolves under a feature this file is a `test_ref` of | **yes** — this is the clause that makes the refactor auditable: it is how you prove a consolidated test still covers the same criteria |
| **T3** the TEST-AUTHOR line is present (19 of 272 files today) | presence **yes**; truthfulness **no** |
| **T4** sibling-ownership note wherever ≥3 suites share a directory | **no** — human |
| **T5** grep-shaped tripwire suites declare themselves (the `tests/code-compact.test.ts:1-15` form) and assemble their needles at runtime so they never self-trip | **yes** |
| **T6** inline comments explain *why an assertion has teeth*, not what the code does | **no** — human |

Target comment share stays near today's measured 10.7% — tests are leaner by design.

**Before / after — tests**

```diff
-// Scenario helpers.
-// See tests/cli/refine.test.ts for the sibling suite.
+// Cladding · scenario fixture helpers — F-7c1d2e44
+//
+// TEST-AUTHOR context: support module, not a suite. No assertions here.
+//
+// Sibling ownership: the clarify lane is pinned by
+//   tests/cli/clarify.test.ts (renamed from refine.test.ts in 0.6.0).
+//   This file owns fixture materialization only.
```

### 4.3 The four classes — and why class 4 is cut

| class | content | DONE condition | lines |
|---|---|---|---|
| **1 — reference integrity** | 36 dangling `@see`, 12 unresolved F-ids, 4 path conventions → 1 | `comments.ts --rule=refs --assert-clean` → `findings=0 visited>150` | ≈ −125 |
| **2 — stale-by-construction** | counts, `file:line`, version promises, dates-as-time-claims, the `UNMAPPED_ARTIFACT` severity row, the EARS count stated 3× in one file, `drift.ts`'s abandoned-architecture header | one regex rule per ban, each with a planted-defect probe; `findings=0` | ≈ −60 deleted, ≈ −150 changed |
| **3 — header cap** | R3 | `--rule=header-cap` → `offenders=0 visited=186` | **−932** (measured, cap 12 / 24-exempt) |
| **4 — free-form narrative removal** | "history narration", "compress in place" | **none exists** | **CUT** |

Class 4 is cut because parity is IDENTICAL either way, BUNDLE-ID is byte-identical either way, and coverage is unchanged either way — a 1,000-line deletion justified by "the reviewer judged it re-derivable" is an assertion, and the maintainer's bar is empirical evidence. The residue is recorded as accepted debt in §9, not deleted on judgement.

**The one thing classes 1–3 must never do**, because nothing in this repo can catch it: **no gate check reads a single byte of `src/**` comment content.** Verified — `CONVENTION_DRIFT` checks only that the first non-empty character opens a comment; `REFERENCE_INTEGRITY` reads only `depends_on` / `superseded_by` / `scenarios[].features` and opens no source file; `DOC_LINK_INTEGRITY` walks `join(cwd,'docs')` only. **(This corrects the task brief's premise #5.)** So the risk is not that a check breaks — it is that the only record of an invariant vanishes with nothing turning red. **U-05 converts every such record into an executable assertion before any comment unit runs**, and the comment units carry a grep-checkable diff rule: *any deleted hunk matching `/MUST|never|only|invariant|severity|finally|rejected|DEFERRED/` must be replaced by a named test in the same commit.*

---

## 5. The work units

### 5.1 Granularity rule

> **One unit = one commit = one reason to change, bounded by ≤400 changed lines and ≤12 touched files, closed by a DONE list in which every entry is a command with a literal expected output.**
> **If any DONE entry can only be written as prose, the unit is inadmissible** — split it, or build the instrument that produces the command first, or drop it.

**Mechanical-rule exception to the 12-file cap.** A unit may touch a whole directory when (i) exactly one rule is applied, (ii) a tool asserts `offenders=0`, (iii) INV-14 shows the bundle byte-identical, and (iv) ≤400 lines change. The file cap exists to make `touch_allowed` verifiable by inspection; for a mechanical rule the tool *is* the verification. Only the class-3 header units and the test-scaffolding units use it, and each names the exception in its record.

**Floor rule.** Do not split below one reason-to-change even when the line count is trivial. `tsconfig` (2 lines), the coverage ratchet (6), and the manifest-honesty test (15) stay three units: different rollbacks, different preconditions, different things made visible.

### 5.2 Unit table

Risk: **L** = revert is a single `git revert`, no derived artefacts · **M** = derived artefacts or generated mirrors move · **H** = spec YAML moves, or a silent-failure vector is in scope.

| id | title | files | Δ lines | depends-on | risk |
|---|---|---|---|---|---|
| **U-00** | Baseline freeze (measure only) | 0 | 0 | — | L |
| **U-01** | `tsconfig` include repair | 1 (+`src/spec/cli.ts` fallout) | +2 / −1 | U-00 | L |
| **U-02** | Coverage ratchet at the measured floor | 1 | +6 | U-00 | L |
| **U-03** | `MANIFEST_HONESTY` test | 1 test + 6 READMEs | +15 | U-00 | M |
| **U-04** | Detector-order golden | 1 test + 6 READMEs | +30 | U-00 | M |
| **U-05** | Invariant lift: 5 comments → assertions | 4 tests + 6 READMEs | +180 | U-00 | M |
| **U-06** | `docs/code-style.md` §3 rewrite + SSoT contradiction | 3 docs | ~90 | U-00 | L |
| **U-07** | Dangling `test_ref` cleanup (2 archived entries) | 2 spec | −3 | U-00 | M |
| **U-10** | Parity core: `normalize` + fixtures + CLI lane | 8 tools | +1,100 | U-01 | L |
| **U-11** | Parity mutants + selftest ◀ **KILL CRITERION** | 3 tools + 1 test | +320 | U-10 | L |
| **U-12** | Parity MCP lane (+mutant) | 3 tools | +350 | U-11 | L |
| **U-13** | Parity hook lane, S+B dual (+mutant) | 3 tools | +300 | U-11 | L |
| **U-14** | Parity artifact + events + TTY lanes (+mutant) | 4 tools | +280 | U-11 | L |
| **U-15** | Parity bundle lane (S vs B) + clean-room | 3 tools | +280 | U-13 | M |
| **U-16** | `tools/audit/census.ts` + `comments.ts` + `checkpoint.ts` | 4 tools + 1 test | +700 | U-10 | L |
| **U-17** | `tools/spec-remap.ts --claim` | 1 tool + 1 test | +260 | U-16 | M |
| **U-20** | ESLint scope repair — **alone, formatting only** | 1 config + ~20 src | ~27 changed | U-11, U-12 | M |
| **U-30** | Delete `optimizer/preamble.ts` + `tail.ts` (ritual rehearsal) | 4 del + 3 spec + 6 READMEs | −170 | U-11, U-16 | **H** |
| **U-31** | Dead symbols: git-hook wrappers, `TIER_COL`, `getTierColor`, `void cwd` | 7 | −58 | U-30 | M |
| **U-40** | Comment class 1 — reference integrity | ~45 | −125 | U-06, U-16, U-20 | L |
| **U-41** | Comment class 2 — stale facts | ~30 | −60 / ~150 chg | U-05, U-40 | L |
| **U-42** | Header cap — `src/stages/detectors/` (30 over) | 30 | −330 | U-41 | L |
| **U-43** | Header cap — `src/cli/` + `src/stages/` (33 over) | 33 | −201 | U-42 | L |
| **U-44** | Header cap — remaining 15 directories (50 over) | 50 | −401 | U-43 | L |
| **U-50** | `isCliEntry` predicate extracted + table-tested | 3 + 1 test | +60 | U-15, U-05 | **H** |
| **U-51** | `cliEntry(importMetaUrl, fn)` applied to 15 runners | 15 | −60 | U-50 | M |
| **U-52** | `detectorBackedStage` (arch ≡ secret) | 3 | −30 | U-51, U-05 | M |
| **U-53** | `scopedStageCommand` + `gateScriptCommand` | 7 | −54 | U-52 | M |
| **U-54** | `readJsonOr` in `src/stages/**` (~10 sites) | 11 | −40 | U-53 | L |
| **U-55** | `hook.ts` sidecar factory + one counting home | 1 | −150 | U-13, U-05 | M |
| **U-56** | `server.ts` `specHandler` + `shimHandler` (in-file) | 1 | −170 | U-12 | M |
| **U-57** | `clad.ts` attestation EXEMPT/STAMP helpers (in-file) | 1 | −20 | U-15 | M |
| **U-58** | `renderScenarioYaml` + conventions table + micro-helpers | 5 | −50 | U-17 | M |
| **U-59** | `intent-onboarding` interpret merge — **CONDITIONAL** | 1 + fixtures | −65 | stub-dispatcher lane | **H** |
| **U-60** | `src/core/paths.ts` — the `.cladding` home | 22 | −45, +1 file | U-17, U-14 | M |
| **U-61** | `src/core/read.ts` — repo-wide read-with-fallback (batched ≤8 files) | 14 | −250, +1 file | U-60 | M |
| **U-62** | `src/stages/cli-entry.ts` + `command-stage.ts` extraction | 17 | −80, +2 files | U-51, U-53 | M |
| **U-63** | `src/serve/onboarding-staging.ts` extraction | 2 | ±0, +1 file | U-56 | M |
| **U-64** | `src/serve/tools/*.ts` + `resources.ts` + `prompts.ts` | 7 | +50, +5 files | U-63 | M |
| **U-65** | `src/cli/hook-sidecar.ts` + `hook-bash-lane.ts` | 3 | +24, +2 files | U-55 | M |
| **U-66** | `src/cli/program.ts` + `src/verdict/attestation-gate.ts` | 3 | −60, +2 files | U-57 | **H** |
| **U-67** | Break `drive ↔ ui`: `src/core/halt-reason.ts` | 4 | −5, +1 file | U-62 | M |
| **U-70** | Break the 5 cross-test source couplings | 6 tests | ~150 chg | U-11 | M |
| **U-71** | `tests/_support/` + migrate the 73 unreferenced files | 75 | −900, +2 files | U-70 | M |
| **U-72** | Migrate `tests/stages/` (pinned, contents only) | ~81 | −400 | U-71 | M |
| **U-73** | Migrate `tests/cli/` + `tests/spec/` | ~60 | −350 | U-72 | M |
| **U-74** | Migrate the remainder | ~35 | −250 | U-73 | M |
| **U-75** | Test header standard + the 25 headerless files | 25 + 1 test | +180 / −250 | U-16, U-74 | M |
| **U-80** | Pin renegotiation residue + exemption register | ~6 tests | ~80 chg | U-74 | M |
| **U-81** | Tooling disposition (a decision, not a cleanup) | varies | 0 to −2,300 | all | L |

**49 units.** All three arms under-counted by roughly 2×.

### 5.3 Unit blocks

Every block below is executed with the §2 invariants as its outer contract; only the **unit-specific** verification is written out.

---

#### PHASE 0 — Baseline and net

**U-00 · Baseline freeze**
*Goal:* nothing in this program may be designed on an unmeasured number.
*Scope:* read-only; writes only to the scratchpad and to `.refactor/baseline.json`.
*Actions:* record at the pinned commit — per-directory `wc -l` and comment share; `vitest list --json` collected count **vs** `vitest run` executed count and **the explanation of the delta**; per-suite times from `.cladding/test-report.junit.xml`; per-file `coverage/coverage-summary.json`; the census tuple; max test-file age (`STALE_TESTS` headroom); tool versions of tsc/eslint/madge/secretlint/vitest; the `dist/` SHA-256 pair.
*Verify:* `census --emit` prints `entries=275 modules=422 modules_absent=0 testrefs=243 testrefs_absent=1`. Any other tuple means the working tree is not the assumed baseline — **stop**.
*Known baseline facts to record so no later unit investigates them as its own regression:* `README.md` badge pins **2815**, `.cladding/test-report.junit.xml` reports **2821** executed across 249 suites in 115.82 s — a **live, unexplained 6-test delta between `vitest list` and `vitest run`**. `scripts/test-count.mjs --check` compares against `vitest list` only, so the delta is stable and harmless. Characterize it here; never "fix" it inside another unit.
*Rollback:* n/a.

**U-01 · `tsconfig` include repair**
*Goal:* stop type coverage being a side effect of test imports.
*Scope:* `tsconfig.json`; whatever `src/spec/cli.ts` surfaces. The unit's spec entry claims `tsconfig.json` in `modules[]` (verified: no entry claims it today).
*Evidence:* `include` currently lists `stages/**`, `spec/**`, `hitl/**`, `router/**`, `ui/**`, `cli/**`, `optimizer/**`, `events/**`, `drive/**` — **9 of 12 globs match nothing**; source moved under `src/` at the v0.2.16 layout change. Only `tests/**`, `conformance/**` and `vitest.config.ts` resolve.
*Actions:* `include: ["src/**/*.ts","tests/**/*.ts","conformance/**/*.ts","tools/**/*.ts","vitest.config.ts"]`, `exclude: ["src/graph/viewer/**"]` (DOM + `three` globals; already ESLint-ignored at `eslint.config.js:13`).
*Invariant preserved:* `tsc --noEmit` exit code stays 0.
*Verify:* INV-4 and **INV-4b** (`--listFiles | grep -c '/src/'` → `185`).
*Rollback:* revert one line.

**U-02 · Coverage ratchet** — `vitest.config.ts` gains `thresholds` at the U-00-measured floor (`vitest.config.ts:32-45` declares none today, and `src/stages/cov.ts:4-9` delegates enforcement to the project, so `stage_2.2` passes at any coverage level). *Verify:* INV-15 exits 0 at baseline; then in a scratch worktree set `lines: 99` and confirm non-zero — the ratchet must be shown to bite. *Rollback:* revert 6 lines.

**U-03 · `MANIFEST_HONESTY`** — new `tests/manifest-honesty.test.ts`: `expect(allDetectors.length).toBe(detectorFilesOnDisk())` **and** `expect(plugin.json.ironclad.current.detectors).toBe(\`${n}/${n}\`)`.
*Evidence, and it is a live vacuous green:* `ls src/stages/detectors/*.ts` = **44**; both `harness-integrity.ts:96-103` and `build-plugin.mjs` Phase D subtract the same 3 helpers → **41**; `allDetectors` = **41**; `plugin.json` = `"41/41"`. They agree by naming luck. `HARNESS_INTEGRITY` compares `plugin.json` to the **file count** and Phase D **writes** `plugin.json` from that same file count — they cannot disagree with each other — and nothing compares either to `allDetectors`. Adding a fourth non-detector helper ships a manifest advertising 42 while 41 run, **fully green**.
*Deliberately a test, not a 42nd detector* — a new detector file would itself trip Phase D and the 8 prose surfaces `self-consistency` pins.
*Verify:* green; then in a scratch worktree add `src/stages/detectors/zz-helper.ts` and confirm **RED**. Test count moves ⇒ `npm run test-count -- --write`, six READMEs, same commit.

**U-04 · Detector-order golden** — new `tests/detector-order.test.ts` pinning `allDetectors.map(d => d.name)` against a literal 41-element array.
*Evidence:* `src/stages/drift.ts:29` snapshots `[...allDetectors]` and pushes findings in exactly that order. All 8 test files importing `allDetectors` assert length, uniqueness, catalog completeness and `subprocess` flags — **never sequence**. Order is user-visible in `check --json`, in the panel render, and — persisted — at `hook.ts:425` (`first: failures[0].detector` into `.cladding/stop-block.json`) and `hook.ts:436-439` (`failures.slice(0,2)` rendered to the user). Any ESLint import-sort `--fix` (U-20) would reorder it silently.
*Verify:* green; scratch-swap two entries → RED.

**U-05 · Invariant lift — five comments become assertions**
*Goal:* convert the load-bearing records that no gate reads into tests, **before** any comment or shell unit can delete them.
*Scope:* 4 new/extended test files; no `src/` change.
*The five, each verified:*
1. **arch/secret never emit `warn`.** `src/stages/arch.ts:35-38` and `secret.ts:34-38` record that the detector emits only `error`/`info`, which is why their `findings.filter(f => f.severity === 'error')` is sound. If either ever gains a `warn`, stage_1.5/1.6 pass while `runDrift({strict:true})` fails — a split verdict inside one gate run. **No test asserts it.** → assert over the fixture corpus.
2. **`with-spec` taxonomy.** The roster is the adjudication of which detectors deliberately `return []` on spec-load failure. → `tests/detector-taxonomy.test.ts` derives both sets from the filesystem and asserts membership, so the comment can state the *rule* and the test owns the roster.
3. **Session-cache lifetime.** `src/spec/load.ts:57`, `src/stages/detector-result-cache.ts:30`, `src/stages/test-run-cache.ts` each state "callers MUST clear in a `finally`". → an `afterEach` guard in the shared test support asserting all three are clear.
4. **`isCliEntry` predicate.** See U-50. → table test including a Windows `argv[1]` row.
5. **Finding shape per detector.** Snapshot `{detector, severity, path, message}` for all 41 detectors over the corpus, **plus** an assertion that the corpus makes all 41 fire at least once (no such assertion exists today). This is what protects the two `detector|path` fingerprints and the SARIF sort key from a normalization.
*Verify:* each assertion planted-defect probed; test count moves ⇒ `test-count --write`.

**U-06 · `docs/code-style.md` §3 rewrite + SSoT contradiction** — resolve the authority conflict (`code-style.md:3` and `AGENTS.md:38` say SSoT; `docs/README.md:14` and `docs/ssot-model.md:63` say Tier-C legacy), then rewrite §3 to name only reference forms that resolve inside this repo. *Verify:* `comments.ts --rule=refs` run against the standard's own examples → 0 findings. *Rollback:* revert.

**U-07 · Dangling `test_ref` cleanup** — drop or repoint `tests/graph/viewer-render.test.ts` in `graph-viewer-obsidian-04f50847.yaml` and `graph-viewer-galaxy-8234ec3c.yaml`. Both are `status: archived` with `modules: []`, so `UNTESTED_AC` skips them — this is cosmetic, and saying so matters: **the surveys' other two reported dangles are false positives** living in scenario `response:` prose, not in `test_refs`. Do not "fix" them. *Verify:* INV-1 → `testrefs_absent=0`.

---

#### PHASE 1 — The instruments

**U-10 · Parity core** — §3.1–3.4 built: `normalize.ts` (imported by both capture and compare — if they normalize differently the harness is worthless), the five fixture tiers, `cases/cli.yaml`, `capture.ts`, `compare.ts`, `allow.yaml` (empty). *Verify:* `capture --lane=cli` twice in a row → IDENTICAL (determinism of the harness itself, before determinism of the product). *Rollback:* delete `tools/parity/`, remove the npm scripts, remove the spec entry — nothing in `src/` was touched.

**U-11 · Mutants + selftest ◀ KILL CRITERION** — §3.5, seven mutants. *Verify:* `selftest` → `7/7 REGRESSION`. **If not green within this unit's budget, the program stops.**

**U-12/13/14 · MCP, hook, artifact+events+TTY lanes** — §3.2, each adding its own mutant and re-running the selftest to `8/8`, `9/9`, `10/10`. U-13 additionally asserts S≡B for every hook sequence at baseline.

**U-15 · Bundle lane + clean-room** — §3.2. *Verify:* fast tier S≡B; then in a scratch worktree break one module's entry guard and confirm S≢B. Clean-room: `npm pack` → install into an empty dir → fast tier green.

**U-16 · Audit tools + checkpoint driver** — `census.ts` (INV-1 plus the `readManifest ∩ modules` overlap per feature and the `STALE_TESTS` headroom), `comments.ts` (the machine-checkable half of §4, with needles assembled at runtime — `['resolve','Threshold'].join('')`, the trick already used at `tests/code-compact.test.ts:25-29` — so the checker never self-trips), `checkpoint.ts` (runs INV-1..19 in order, one verdict). **All audit tools are read-only**: the tool that finds the problem never fixes it. *Verify:* `comments.ts` emits a finite worklist matching the independently-measured counts — ≥36 dangling `@see`, ≥12 unresolved F-ids, ≥7 `file:line`, ≥6 version promises; each rule has a planted-defect probe.

**U-17 · `spec-remap --claim`** — appends exactly one `modules[]` line to one feature, using the byte-stable technique already proven in `src/spec/test-ref-repair.ts:141` (`body.split(ref).join(to)`) so the entry stays diff-clean elsewhere. Dry-run by default; `--apply` writes; refuses when the target path is already claimed by a different feature or during a git operation. **`--rename` is deliberately NOT built** — this program moves no file, and a rename mode would be an unused loaded gun (if it is ever built, it must be driven by `git diff --find-renames`, not basename: 9 of 183 src basenames are ambiguous and they are exactly `index.ts` ×3, `types.ts` ×5, `README.md` ×3, `render/report/stats/verdict/audit/spec-conformance`). *Verify:* `git diff --stat` after a claim shows `1 insertion(+)`.

---

#### PHASE 2 — ESLint

**U-20 · ESLint scope repair — alone**
*Goal:* apply the project rule block to the 186 src files it has never reached.
*Evidence:* `eslint.config.js:17` declares `files: ['stages/**/*.ts', …, 'drive/**/*.ts']` — flat-config globs resolve from the config directory, so **0 of 186** src files match; `tests/**` does match, which is why the asymmetry was invisible. Measured cost by simulating the rules: **27 problems (25 errors, 2 warnings), 100% auto-fixable, all 25 errors from the single `quotes` rule** — a ~20-file, ~27-line diff, not a tree-wide reflow.
*Actions:* prefix the 11 globs with `src/`; `npx eslint src --fix`. **This commit contains nothing but formatting.**
*Invariant:* zero behavioural change. Also: `eslint --fix` must not reorder imports (no import-sort rule is configured — confirm before running, because INV-17 depends on `allDetectors` order).
*Verify:* INV-5 exit 0; `compare --tier=full` → **IDENTICAL, allow.yaml empty**; INV-17 green; non-vacuity probe — `npx eslint src --rule '{"quotes":["error","double"]}'` must now report many errors, proving src is inside the rule scope.
*Rollback:* revert; the diff is mechanical. **Never bundle with a refactor unit.**

---

#### PHASE 3 — Deletions

**U-30 · Delete `src/optimizer/preamble.ts` + `tail.ts`** — the ritual rehearsal on the smallest possible surface.
*Evidence, three ways:* `grep -rn "preamble.js'\|tail.js'" src` → 0 importers (the only `preamble` hit in src is unrelated prose in `core/telemetry-summary.ts`); `git log --all -S"suppressPreamble" -- src` → one commit, the layout move, i.e. never wired; and both files are 2 of the only 4 src files reachable from neither esbuild entry point. `preamble.ts`'s regex still matches `Librarian`/`Specialists`, personas renamed in 0.6.0.
*Exact spec cost:* `F-041.yaml` — remove 2 `modules[]` lines, remove `AC-065` + `AC-066`, **retitle** (its title names "preamble suppression, tail-only logging"); `F-063.yaml` — remove 2 test module paths and `AC-161`; `conformance/fixtures.yaml` — remove the 2 `F-041_AC-065` / `F-041_AC-066` rows, **or `FIXTURE_REFERENCE_INVALID` fires**; then `clad sync` + a green strict pre-push.
*Red-inside-the-commit window (acceptable):* between dropping the ACs and dropping the fixture rows.
*Verify:* INV-1 → `modules=420 modules_absent=0`; `compare --tier=full` → IDENTICAL (dead code emits nothing); `test-count --write`.
*Rollback:* `git revert`, then `clad sync` + a green strict pre-push to re-derive. **This is the only unit in the program that edits a pre-existing `done` feature's ACs** (see §10 Q3).

**U-31 · Dead symbols** — `src/init/git-hook.ts:100-122` (`renderPreCommitHook` / `installPreCommitHook`, self-described "Back-compat wrapper (pre-0.6 callers/tests)"; real importers use `installGitHook` / `enforcingHookInstalled`); `src/graph/stellar.ts` `TIER_COL` (its only importer `src/graph/viewer/main.ts:26` imports six symbols and `TIER_COL` is not among them, and `main.ts:502` says "Tier filter rows carry no color" — the constant's own comment is false); `src/graph/render.ts` `getTierColor`; `src/serve/server.ts` `registerPrompts`'s unused `cwd` + its `void cwd;`. Rewrite the affected test cases to the real API. **No file is deleted**, so `MISSING_IMPLEMENTATION` cannot fire and `modules[]` is untouched. *Verify:* `audit/exports` "truly unreachable" bucket is **empty**; tripwire asserting the four symbol names appear in no file under `src/` or `tests/` (needles assembled at runtime, walk >150 files); `test-count --write`.

---

#### PHASE 4 — Comments

**U-40 · Class 1, reference integrity** — worklist from `comments.ts --rule=refs`. Delete or repoint 36 `@see` targets (19 × `iron-law.md`, 17 × `ironclad-design/**` — neither exists); repoint the 12 unresolved F-ids (`F-084/085/087/088`, deleted by the v0.3.16 migration) or drop them; one path convention replacing four; delete the 7 `file:line` coordinates (≥3 already wrong, one pointing **inside `node_modules`**); fix `docs/spec-ids-multi-dev.md:179` and `spec/architecture.yaml:5`.
*Hard exclusion:* the six adapter files pinned by `tests/docs-prune.test.ts:157-167` must each keep the literal `docs/multi-provider-roadmap.md`, and the three transport files must keep `Transport architectural decision`.
*Verify:* `--rule=refs --assert-clean` → 0; **INV-14 bundle byte-identical**; `git diff plugins/claude-code/dist/clad.js` empty.

**U-41 · Class 2, stale facts** — the counts (`with-spec.ts:23,30` says 11/6, actual 21/20 — replaced by U-05's derived taxonomy, not by a new number; `absence-of-governance.ts:5` says "the other 25", actual 40; `hardcoded-secret.ts:4` says "the 19-detector catalog", actual 41); the 24 `Detector #N` header lines (17 detectors carry none, and `README.md:10` already declares the filesystem authoritative — a second registry nothing enforces); `src/spec/types.ts:5,9,42` stating the EARS count three times ("5-pattern", "6 canonical", "5 EARS patterns") against a 6-member union; `drift.ts:8-12` describing an abandoned `registerDetector` architecture and naming `SECRETS_PRESENT`/`ARCH_DRIFT`, neither of which exists; `src/stages/detectors/README.md:16` declaring `UNMAPPED_ARTIFACT` severity `warn` while `:84` and `unmapped-artifact.ts:103` both say `error`; the 6 future-release promises; the 24 dates-as-time-claims.
*Split out, deliberately:* the `META_INTEGRITY` `spec/schema.json` vs `src/spec/schema.json` mismatch has **user-visible** halves — two finding messages and the repair card at `src/ui/softShell.ts:154` tell a user to look in a directory that has no such file. Fix the **comments** here; the strings go to §8.
*Keep:* `registerDetector` / `clearDetectors` themselves — 6 test files depend on them as an isolation seam.
*Verify:* `--rule=facts --assert-clean` → 0; a new assertion that parses the detector README catalog table and requires every declared severity to be in the set the file emits (0 divergences after, 1 before — record both); INV-14.

**U-42/43/44 · Class 3, header cap** — R3 applied by directory batch. Measured overage at cap 12 with the 9 contract modules at 24: **113 files, 932 lines**, splitting as `stages/detectors` 30 files / −330 · `cli` + `stages` 33 files / −201 · the remaining 15 directories 50 files / −401.
*Actions per batch:* trim to line 1 + blank `//` + ≤10 lines of WHY. Overflow that is a genuine decision record moves to `docs/` behind a resolving `@see`; overflow that is summary or history is deleted. Any file that cannot meet the cap without losing a decision is added to `tools/audit/exemptions.yaml` **with this unit's id and the reason** (expected: `src/stages/detectors/spec-conformance.ts`, whose 51-line header carries the "DEFERRED to v2: a spec-rev hash" adjudication).
*Diff rule, grep-checkable:* any deleted hunk matching `/MUST|never|only|invariant|severity|finally|rejected|DEFERRED/` must be replaced by a named test in the same commit — or the hunk is restored.
*Verify per batch:* `--rule=header-cap` → `offenders=0 visited=186`; **INV-14 bundle byte-identical** (this is the strongest available evidence for a 300-line deletion: identical bytes out); INV-5; INV-6; INV-10.
*Rollback:* per batch — which is why it is three units and not one.

---

#### PHASE 5 — In-place dedup

**U-50 · `isCliEntry` predicate — extract and table-test first**
*Goal:* make the guard testable before 15 files depend on one copy of it.
*The finding, and it is not in any survey:* all 17 sites spell it `!globalThis.__CLADDING_BUNDLED && import.meta.url === \`file://${process.argv[1]}\``. On POSIX `argv[1]` is `/abs/x.ts` so the concatenation yields `file:///abs/x.ts` and matches. **On Windows `argv[1]` is `C:\…\x.ts`, so it yields `file://C:\…\x.ts`, which never equals Node's `file:///C:/…/x.ts`.** Every one of the 13 `stage:*` scripts and `src/cli/benchmark.ts:70` is therefore a silent no-op on Windows today — loads, prints nothing, exits 0. Coverage is zero either way (`__CLADDING_BUNDLED`: 17 src files, **0 test files**), CI is ubuntu, dev is darwin.
*Actions:* extract `isCliEntry(importMetaUrl, argv1, bundled): boolean` into `src/stages/util.ts` as a **pure function**; table-test it, including a `'C:\\r\\s.ts'` row that documents current behaviour. **Do not change the behaviour in this unit** — see §10 Q6.
*Invariant:* `__CLADDING_BUNDLED` semantics byte-for-byte; that guard is the only thing stopping the esbuild bundle firing all 13 stages on import.
*Verify:* the table test green; INV-14 (predicate extraction is a code change, so the bundle **will** move — this unit is not comment-only); S≡B on the bundle lane.

**U-51 · `cliEntry(importMetaUrl, fn)` applied** — 15 runners collapse their trailer to one call. **`src/cli/clad.ts` keeps its own guard** (it is the bundle entry itself; importing `stages/util.js` for 4 lines changes the entry module's import graph for no gain).
*Cycle check, verified:* `src/stages/detectors/{hardcoded-secret,architecture-violation}.ts` already import `../util.js`, and `util.ts` currently imports only `node:fs` + `node:path`. **`execaSync` must never enter `util.ts`** — `tests/stages/interactive-profile-partition.test.ts:29` matches `SPAWNER_IMPORT` against each detector file's **own source text**, so moving a spawn into a shared helper makes the two subprocess-using detectors stop matching and the test **stops requiring `subprocess: true`** — going green harder while the guard it protects (a per-keystroke subprocess spawn in the PostToolUse lane) silently dies.
*Verify:* `for s in type lint drift secret commit arch unit cov smoke perf visual audit uat; do npm run stage:$s >/dev/null; echo "$s $?"; done` — exit-code vector identical to the U-00 recording; `npx madge --circular --extensions ts src` → 0; INV-3; S≡B.

**U-52 · `detectorBackedStage`** — folds `arch.ts` ≡ `secret.ts` (3 semantic lines differ of 53).
*Two traps this unit must resolve explicitly, not inherit:* (a) their JSDoc contracts **differ** — secret documents a `cmd`/`args` override, arch documents only `cwd`; but both bodies read `readDetectorResult(detector.name, cwd) ?? detector.run(opts)`, so whenever a gate run has primed the session (including the Stop hook via `primeDetectorResultCache`) the overrides are **silently discarded**. Decide the precedence, document it, and test it — a factory that makes the asymmetry uniform and undocumented is strictly worse than the duplication. (b) The `never warn` invariant is now U-05's assertion, so the `filter(f => f.severity === 'error')` fold is defended by a test rather than a comment.
*Verify:* a new test that primes the cache with synthetic findings and asserts the decided precedence; INV-3; S≡B.

**U-53 · `scopedStageCommand` + `gateScriptCommand`** — into `src/stages/toolchain/scoped-command.ts` (**not** `util.ts`; verified that nothing under `src/stages/toolchain/` imports `../util.js` and no detector imports `scoped-command.ts`, so **no detector's import graph changes at all**). Each returns `StageResult | {cmd, args}`; **`execaSync` stays in the caller**. The `if (!cmd || !args)` guards are **not** dead — `resolveStageCommand` returns `{cmd: repoGate?.cmd}`, `undefined` for an unregistered language.
*Verify:* `npm run conformance` exit 0 — the only place real `tsc`/`eslint`/`madge`/`secretlint` binaries run against synthetic repos, and the only live proof these six stages still resolve real commands; stage exit-code vector unchanged.

**U-54 · `readJsonOr` in `src/stages/**`** — promote the good shape that already exists at `harness-integrity.ts:105-112` into `src/stages/util.ts` and migrate the ~10 sites in that tree. **Each site keeps the exact fallback value it returns today** — returning `[]` where a site returned `null` changes detector severity. Seven sites additionally guard `existsSync` *then* `try/catch`; the `existsSync` is redundant because the catch covers ENOENT, but **removing it is a separate decision** and is not taken here. *Verify:* U-05's per-detector finding-shape snapshot unchanged; parity full IDENTICAL.

**U-55 · `hook.ts` sidecar factory** — one module-private `sidecar<T>(cwd, filename)` returning `{read(defaults), write(v)}` replacing four families with identical shape (`SkipAgg`, `UnboundAgg`, `PushLedger`, tree snapshot; the source admits it — `:588` "Same sidecar discipline as SkipAgg"), plus a local `readJsonOr` for the file's 6 `JSON.parse(readFileSync(` sites, plus routing `renderSessionStartCard` through `computeInventory` instead of its own `parseYaml` (the same tally exists in four places).
*Invariants:* per-family field coercion stays **inside each family** — the generic only does parse-or-defaults. Every write keeps swallowing errors: 21 of the repo's 67 silently-swallowing catch blocks are in this file and that is the hook's contract (a broken ledger must never crash the host; `runHookCommand` always exits 0). stdout stays byte-identical — it is the entire protocol. `hook.ts` is claimed by 17 features: **it shrinks in place, it never moves.**
*The fingerprint trap, stated so the agent does not walk into it:* `hook.ts:412-414` computes `` `${f.detector}|${f.path}` `` and `src/verdict/gate-progress.ts:52` computes `` `${f.detector}|${f.path ?? ''}` `` — and `gate-progress.ts:25-26` *claims* they mirror each other, which is an explicit invitation to dedupe. **They are not the same function.** Unify them and any finding without a `path` flips between `X|` and `X|undefined`; every existing `.cladding/stop-block.json` on every adopter machine stops matching, so the first Stop after upgrade **re-blocks instead of demoting** — the exact failure the demotion exists to prevent. Both values are opaque sha256s and every test writes fresh state, so nothing turns red. **This unit does not unify them.** If they are ever unified, golden-vector tests (a fixed finding array containing one `path: undefined` row → an asserted literal sha256, one per call site) land first, plus a parity hook sequence that seeds an OLD-build `stop-block.json` and asserts demotion still fires.
*Verify:* the 9 `tests/cli/hook*.test.ts` suites green; parity hook lane IDENTICAL in **both** S and B lanes, including final sidecar contents.

**U-56 · `server.ts` `specHandler` + `shimHandler` (in-file only)** — `specHandler(cwd, body)` owns `loadSpecOrError` → `'error' in loaded` → `try/catch` → envelope; `shimHandler(cwd, argv, body)` owns `engineShim → spawnSync → JSON.parse → error envelope`, duplicated verbatim at `:1099-1133` and `:1158-1191` (35 lines each for ~6 lines of difference).
*Non-negotiable:* the `server.registerTool(name, meta, handler)` **call shape** and every `title` / `description` / `inputSchema` literal stay byte-identical. Only handler *bodies* change. That is what makes the wire contract provably untouched — `listTools()`, the zod→JSON-Schema serialization and property declaration order are all outside the edited region. Tool names stay spelled as **literals** at the registration site: `tests/self-consistency.test.ts:160-167` scrapes `'clad_[a-z_]+'` out of this file by regex, and an interpolated name turns it red.
*The envelope trap:* 22 `registerTool` / 26 `mcpPayload` / **49** `type: 'text'` / **20** `schema_version` — so ~23 responses today carry **neither** `structuredContent` **nor** `schema_version`. **These two helpers must NOT normalize the envelope** — they own spec-loading and error translation only. Adding `structuredContent`/`schema_version` uniformly is a wire change belonging to §8, and it lands on four generated host mirrors this repo never executes.
*Verify:* parity MCP lane IDENTICAL on the **whole response object** for all 22 tools × success and error branches, in both serializations.

**U-57 · `clad.ts` attestation helpers (in-file)** — collapse the 31-line EXEMPT/STAMP block at `:643-673` into two guarded helpers. Semantics untouchable: exemption applies only when `strict && (tier === 'pre-push' || tier === 'all') && !anyFailed`, and the stamp is skipped during a git operation. *Verify:* `tests/cli/gate-golden-matrix.test.ts` (the explicit characterization lock for `runCheckStages` — 0/1/2 exit contract, `worst` computation, strict skip-promotion demand table, all 15 runners stubbed) green; run `check --tier=pre-push --strict` twice — first stamps, second is green with no stamp.

**U-58 · Small verbatim duplications** — `renderScenarioYaml` (byte-identical at `src/cli/clarify.ts:423-448` and `src/cli/init.ts:690-716`, with `clarify.ts:424-427` admitting the copy) → **`src/spec/render-scenario.ts`** (the structurally correct home; `cli → spec` is already a permitted edge, and this is why Phase 6's relaxation of the new-file rule pays for itself immediately); the 14-line conventions markdown table (`greenfield-seeds.ts:291-304` ≡ `llm.ts:344-357`); the 19-line exact clone `src/spec/inventory.ts:33-51` ≡ `src/stages/detectors/ai-hints-forbidden-pattern.ts:29-47` (the largest in `src`); `truncate` / `asString` / `truncateError` imported from one home. New file claimed via `spec-remap --claim`. *Verify:* artifact lane — run `clad init` and `clad clarify --no-llm` in two scratch fixtures before/after and `diff -r` the produced trees → identical.

**U-59 · `intent-onboarding` interpret merge — CONDITIONAL**
*Change:* `interpretOnboardingWithFallback` (`:488-560`) and `interpretRefinementWithFallback` (`:812-878`) become thin wrappers over one `interpretWithFallback({buildPrompt, fallback, defaults})`. They are line-for-line identical except the prompt builder, the fallback producer, and three per-artifact defaults.
*The honest limitation:* every parity capture runs with the 8 provider keys unset (`src/cli/scan/dispatcher.ts:91-106` selects a provider purely from env presence), which forces the deterministic interpreter — so **the LLM branch is exercised by nothing**. This is the largest dedup in `cli/` and the one parity cannot see.
**GATE:** requires a stub-dispatcher lane that injects a deterministic dispatcher recording the emitted prompt **byte-exactly** and returning canned replies (all-sections-present and sentinel-missing), extending the `tests/cli/fixtures/host-smoke/*.txt` idiom. **If that lane is not built, drop this unit.** Merging it on unit-test evidence alone contradicts the program's premise.

---

#### PHASE 6 — Additive extraction (admitted only after U-12 and U-15 exist)

Shape, for every unit in this phase, taken verbatim from the repo's own precedent (`tests/measure-extract.test.ts:1-12` + `spec/features/measure-extract-1e9ef827.yaml`, which chose "the light variant that requires zero spec-shard module edits" because ~40 entries bind `clad.ts`): **the pinned file stays at its path as a thin composition root; the body moves to a new sibling; the new path is added by `spec-remap --claim` to the unit's own new spec entry, which also lists the already-claimed origin.** Cost per new file: one `modules[]` line, one `attested_modules` row, one rebuild. No path ever disappears, so `MISSING_IMPLEMENTATION` is structurally unreachable, `test_refs` are untouched, and `spec/index.yaml` / `spec.yaml::inventory` do not move (verified: they carry **counts, never paths** — `grep -c "src/" spec/index.yaml` → **0**; **this corrects the task brief's premise #4**).

Each unit also ships a small structural tripwire suite in the `tests/measure-extract.test.ts` style — but with **superset** assertions, not `toEqual` on an export set, so a later legitimate addition does not turn it red.

- **U-60 · `src/core/paths.ts`** — named accessors (`stateDir`, `configPath`, `eventsLog`, `stopBlock`, `auditLog`, `hookSidecar(name)`, …) replacing 39 `.cladding` literals across 21 files. **Split the API in two:** `fsPath()` (platform `join`) and `wirePath()` (always posix). Verified reason: `src/init/host-setup.ts:92` builds `RUNTIME_RELATIVE` with `join()` while `ignoreLocalRuntime` writes the **posix literals** `/.cladding/host/` and `/.cladding/setup-status.json` into `.git/info/exclude`, and `src/init/agents-md.ts:140` emits the posix string `node .cladding/host/serve.cjs` into the managed AGENTS.md block **that the agent then executes**. A single `join()`-shaped accessor backslashes that instruction on Windows. *Verify:* every string landing in a generated manifest or managed markdown block is `wirePath()`-shaped; artifact lane IDENTICAL; a `path.win32`-simulated test for `runtimeBody`, `ignoreLocalRuntime` and the AGENTS.md block.
- **U-61 · `src/core/read.ts`** — `readJsonOr<T>` / `readYamlOr<T>` for the remaining ~50 sites, batched ≤8 files per commit inside the unit. Each site keeps its exact fallback. *Verify:* per batch, U-05's finding-shape snapshot unchanged; parity full IDENTICAL.
- **U-62 · `src/stages/cli-entry.ts` + `command-stage.ts`** — the trailers and stage factories from U-51/U-52/U-53 move out of `util.ts` into dedicated modules; the 13 stage files stay at their paths (npm-script targets **and** spec module paths), reduced to ~8–12 lines each. **New files go in `src/stages/`, never `src/stages/detectors/`** (INV-16's rule). *Verify:* S≡B; stage exit-code vector; `tests/stages/interactive-profile-partition.test.ts` **upgraded** in this unit from a direct-import regex to a one-or-two-hop transitive closure, with a positive control (removing `subprocess:true` from a real detector in a scratch worktree must go RED).
- **U-63 · `src/serve/onboarding-staging.ts`** — the ~280 lines at `server.ts:356-634` (zod host-draft schema, deflate/inflate token codec, pending-preparation persistence + TTL purge, workspace snapshot hashing, rollback capture/restore). `approvalChallenge()` is part of the wire contract — `clad_init` requires the exact string back. The rollback capture/restore pair is atomic: extract together or not at all.
- **U-64 · `src/serve/tools/*.ts` + `resources.ts` + `prompts.ts`** — `src/serve/tools/` is a **nested** directory, invisible to `checkUndeclaredDirectories` (depth-1 only), but `scanPatterns` globs `src/serve/**/*.ts`, so every new file needs its `modules[]` line. **Never name a nested directory after an existing layer** — `importsLayer` matches by path segment, so `src/serve/spec/` or `src/cli/spec/` would false-fire `ARCHITECTURE_FROM_SPEC`. *Verify:* MCP lane IDENTICAL; INV-1 shows 0 unclaimed files.
  *Also in scope:* persona resolution is candidate-ordered against `import.meta.url` (`src/agents/loader.ts:99-113` returns the first existing of `here/<id>.md`, `here/agents/<id>.md`, `here/../plugins/claude-code/agents/<id>.md`, else falls back to `candidates[1]` **unconditionally**, so a miss surfaces only later as a read failure). Assert `resolveAgentPath` returns an existing file for all 5 personas in **both** lanes, and assert `scripts/build.mjs`'s copy source is the same directory `loadPersona` reads in dev.
- **U-65 · `src/cli/hook-sidecar.ts` + `hook-bash-lane.ts`** — **flat file names, not a `src/cli/hook/` directory**: `hook.ts` and a `hook/` sibling co-exist legally, but nine `tests/cli/hook*.test.ts` files and several globs make the ambiguity a needless risk.
- **U-66 · `src/cli/program.ts` + `src/verdict/attestation-gate.ts`** — the 263-line commander wiring moves out; the multi-line `.description(…)` prose is **relocated, never reflowed** (user-facing). **`TIER_STAGES` stays in `clad.ts` as a literal `export const` block** (INV-18). The `.command('<verb>')` literals stay spelled out — `self-consistency.test.ts:143` scrapes them, and `terminology-canon.test.ts:217-227` slices the `.command('status')` block. **Do not table-drive the registration** in this unit: a `{cmd, desc, opts[], action}` loop stops matching the regex and turns a correct change red; the honest fix is to export the verb list as a real array, which is §8 work (U-70 does the test-side half). *Verify:* `npm run build && git diff --exit-code` (proves Phase E still parsed `TIER_STAGES` — a stale `stages-implemented` shows as a diff); all 28 `--help` captures IDENTICAL.
- **U-67 · Break `drive ↔ ui`** — move the `HaltReason` type to `src/core/halt-reason.ts`; both `drive` and `ui` then import downward. *Evidence:* `src/ui/softShell.ts:13` imports `type HaltReason` from `../drive/halt.js` (tier 0 → tier 2) while `src/drive/loop.ts:38` imports `../ui/pulse.js`; Tarjan over all 186 files finds **0 file-level SCCs**, so `madge --circular` is green and structurally always will be — it sees files, not directories.
  **Explicitly NOT in this unit, and not in this program:** adding `{from: ui, to: drive}` to `forbidden_imports`, extending `ES_IMPORT_RE` to match `export … from`, and deriving forbidden pairs from the tier order. All three are **detector behaviour changes** that would emit new `error`/`warn` findings on adopter repos (a barrel re-export; a tier-ordered `architecture.yaml`) and belong to §8. Watch also: `importRe` is a module-level `/g` regex whose single `lastIndex = 0` reset lives inside the per-file loop at `architecture-from-spec.ts:209` — extracting that loop without carrying the reset makes findings depend on the previous file's match position.

---

#### PHASE 7 — Tests

**U-70 · Break the five cross-test source couplings** — **before** any consolidation, correcting ARM C's placement.
*The five, verified:* `tests/terminology-canon.test.ts:249-271` slices `tests/self-consistency.test.ts` **by test name**; `tests/instruction-led-language.test.ts:215-221` regex-derives its byte ceiling from `tests/claude-md-diet.test.ts`'s source and `:300-319` pins that its needle set appears in **exactly one** file across 249 with `expect(hits).toHaveLength(2)`; `tests/code-compact.test.ts:145-149` asserts on `tests/optimizer/code-excerpt.test.ts`'s text; `tests/docs-prune.test.ts:225-239` slices `tests/scenarios/ab/_report.ts`.
*Actions:* export `CLAUDE_MD_SECTION_MAX_BYTES` from `src/init/host-instructions.ts` so the literal `1250` appears once (it appears three times today); replace each source-slice with a direct re-assertion of the property; convert the exactly-one-file census to a whitelist that tolerates additions by explicit opt-in.
*Verify:* `grep -rn "readFileSync.*tests/" tests --include='*.test.ts'` → only intended survivors; plant the original violation each assertion was written to catch and confirm it still goes RED.

**U-71 · `tests/_support/` + the 73 unreferenced files** — `tmpRepo(prefix)` (mkdtemp + `onTestFinished` teardown) and a fluent `specFixture(dir).project(…).feature(…).write()`.
*Measured:* **461 `mkdtempSync` calls across 167 of 249 suites**; `schema: "0.1"` **201 times in 95 files**; 48 mutually-incompatible local helpers (`writeSpec` ×16 with five different signatures, `writeFeature` ×6, `seed` ×6, `writeMaster` ×5, `makeSpec` ×5, `writeShard` ×4, `mkSpec` ×3, `makeTmp` ×3). The only existing shared helper is imported by 7 files, all under `tests/scenarios/`.
*Why the pilot zone:* 176 of 249 suites are pinned by a `test_ref` (paths frozen, contents free); **73 files / 12,976 lines carry none** — the only zone where a mistake costs one revert instead of a spec sweep.
*Two hard constraints.* (a) **`tmpRepo()` is one directory per case, never reused within a file.** Verified reason: `src/spec/load.ts:57` `runCache` returns the cached Spec whenever `resolve(cwd) === runCache.cwd`, and `detector-result-cache.ts` / `test-run-cache.ts` are keyed the same way; `vitest.config.ts` sets no `pool`/`isolate`, so isolation is per **file** — exactly the scope consolidation operates in. Reusing one directory across cases makes case 2 silently read case 1's spec and case 1's cached arch/secret findings. (b) **Anything an assertion depends on stays literal at the call site**; only the invariant frame moves — a test whose fixture is hidden behind a builder default stops documenting what it asserts.
*The vacuous-pass trap this unit must defend against:* `src/stages/drift.ts:10-12` states outright that "with an empty registry the stage trivially passes — by design", and `clearDetectors()` empties the module-level array. Four suites (`scenario-coverage`, `planned-backlog`, `hollow-governance`, `drift-interactive-profile`) use `beforeEach: clearDetectors(); registerDetector(X)` and assert `expect(report.pass).toBe(true)` — **byte-identical to the empty-registry result**. Move that setup into a shared helper, or let one `beforeEach` shadow another, and the suite passes while asserting nothing. **Rule:** the shared helper asserts `registeredDetectors().map(d=>d.name)` equals the expected set before the act, and every `runDrift`-based test asserts a **positive** discriminator (`findings.some(f => f.detector === NAME)`) in the same act.
*Verify:* `npx vitest list --json` before/after → **identical test-name list**, not merely the same count; per-file coverage percentages do not decrease; INV-7 still `2815`.

**U-72/73/74 · Migrate the pinned suites, contents only** — `tests/stages/` first (most uniform), then `tests/cli/` + `tests/spec/`, then the remainder. **No test file is renamed, split or deleted, and no `test()` block is renamed** — `UNTESTED_AC` resolves only the pre-`#` path part, so renaming a test *title* breaks human traceability silently rather than turning the gate red. The deliberate mutation probes must survive intact (`tests/instruction-led-language.test.ts:272-298`, `tests/spec-first-window-complete.test.ts:230-284`'s `vi.doMock`, `tests/readme-record-honesty.test.ts:118-122`, `tests/terminology-canon.test.ts:181-185`) — they are what prove the scanners still discriminate; re-run them explicitly after each batch.

**U-75 · Test header standard** — apply §4.2 to all 272 files, starting with the 25 headerless ones; fix the ~69 stale path citations (`tests/scenarios/_helpers.ts:6` and `greenfield-lifecycle.test.ts:11` cite `tests/cli/refine.test.ts`, renamed to `clarify.test.ts` in 0.6.0; ~20 comments write `spec/load.ts` meaning `src/spec/…`, and `spec/` is a real top-level directory of YAML so these read as real paths that do not exist; `conformance/runner.ts:3` says "12 fixtures" while `.github/workflows/ci.yml:44` says "33 runnable pairs" — one is stale). *Verify:* T1/T2/T3/T5 assert clean over 272 files; `test-count --write`.

---

#### PHASE 8 — Close

**U-80 · Pin renegotiation residue** — for each pinning assertion the program legitimately loosened, a dated rationale comment in the repo's own amendment style (`tests/claude-md-diet.test.ts:78-84` is the model). Convert `tests/spec-first-window-complete.test.ts:205-217`'s `toEqual` on definition sites and importer names to a definition-count-of-1 plus a superset check, keeping the `vi.doMock` mutation probe untouched. **No assertion is deleted to make a diff green**; each keeps its purpose.

**U-81 · Tooling disposition** — an explicit keep/delete decision per tool, recorded. Recommendation: **keep** `parity/lanes/bundle` (the only bundle coverage that exists), `spec-remap` (the repair writer the repo has always lacked), `audit/census` and `audit/comments` (the only comment-integrity check anywhere); **delete** the one-shot analyses after their worklists are exhausted. See §10 Q5.

---

## 6. Checkpoint record format

One YAML file per unit at `.refactor/units/<id>.yaml`, committed **with** the unit. It is both the agent's **entry brief** — so it never re-derives a survey — and the **exit receipt**, so the next unit starts from measured state rather than from this document. Fields marked `[carry]` are copied into the next unit's `inherits`.

```yaml
id: U-42
title: "Header cap ≤12 — src/stages/detectors/"
phase: 4
reason_to_change: "file-header length policy"   # exactly ONE. Two reasons = two units.
mechanical_rule_exception: true                  # §5.1; lifts the 12-file cap

inherits:                       # [carry] from the previous unit's exit block
  baseline_commit: 23ea6be
  census: {entries: 275, modules: 420, modules_absent: 0, testrefs: 243, testrefs_absent: 0}
  test_count: {collected: 2815, executed: 2821,
               delta_explained: "PRE-EXISTING vitest list-vs-run delta, characterised in U-00. DO NOT INVESTIGATE."}
  coverage_floor: {lines: 85, branches: 76, functions: 88, statements: 84}
  parity_selftest: {mutants: 10, regressed: 10, at_commit: <sha>}
  bundle_sha: {clad: <sha256>, viewer: <sha256>}
  allowlist_entries: 0
  stale_tests_headroom_days: 17.4
  detector_order_golden: tests/detector-order.test.ts

preconditions:                  # hard gate; the agent refuses to start if unmet
  units_done: [U-00, U-01, U-02, U-03, U-04, U-05, U-06, U-07, U-10..U-17, U-20, U-30, U-31, U-40, U-41]
  assert:
    - {cmd: "npx tsx tools/audit/census.ts --assert", expect: "exit 0"}
    - {cmd: "npx tsx tools/parity/selftest.ts",       expect: "10/10 REGRESSION"}
    - {cmd: "git status --porcelain",                  expect: "<empty>"}

touch_allowed:                  # EXHAUSTIVE. A diff outside this list is a class-A failure.
  glob: "src/stages/detectors/*.ts"
  max_files: 30
touch_forbidden:
  paths: [src/cli/clad.ts, src/spec/schema.json, src/spec/types.ts, src/spec/validate.ts,
          "src/agents/*.md", "src/graph/viewer/**", src/stages/detectors/index.ts]
  symbols: [TIER_STAGES]
  directives_are_code: ["eslint-disable*", "@ts-expect-error"]   # 4 live sites; never deleted
  content_pins:
    - {file: src/stages/detectors/with-spec.ts, keep: "load-failure policy WHY block", cap: 24}
    - {file: src/stages/detectors/unmapped-artifact.ts, lines: "52-59", cap: 24}
    - {file: src/stages/detectors/hardcoded-secret.ts, lines: "47-50", cap: 24}
  diff_rule: "any deleted hunk matching /MUST|never|only|invariant|severity|finally|rejected|DEFERRED/
              must be replaced by a named test in the same commit, or restored"

pins_that_can_fire:             # PRE-COMPUTED. The agent must not discover these at checkpoint time.
  - {test: tests/self-consistency.test.ts, why: "detector count vs 8 prose surfaces", expect: green}
  - {test: tests/plain-render.test.ts,     why: "pins finding message strings",       expect: green}
  - {test: tests/docs-prune.test.ts,       why: "pins PRESENCE of docs/multi-provider-roadmap.md in 6 adapter files",
     expect: green, note: "src/adapters/ NOT in scope this unit"}

change:
  spec_entry: F-<hash>          # authored FIRST, status in_progress
  spec_cost: {entries_edited: 0, entries_created: 1, modules_added: 0, testrefs_added: 0}
  description: >
    Trim every header in src/stages/detectors/ to ≤12 lines (≤24 for the 3 named
    contract modules): line 1 banner, blank //, ≤10 lines of WHY. Overflow that is a
    decision record moves to docs/ behind a resolving @see; overflow that is summary
    or history is deleted.

done_conditions:                # every entry is a COMMAND + a LITERAL expected result.
  - {cmd: "npx tsx tools/audit/comments.ts --rule=header-cap --dir=src/stages/detectors",
     expect: "offenders=0 visited=44"}
  - {cmd: "npx tsc --noEmit",                        expect: "exit 0"}
  - {cmd: "npx eslint .",                            expect: "exit 0"}
  - {cmd: "npm test",                                expect: "249 files, 2821 tests, 0 failed"}
  - {cmd: "npm run test-count -- --check",           expect: "check passed (2815)"}
  - {cmd: "npm run build && git diff --exit-code",   expect: "exit 0"}
  - {cmd: "shasum -a 256 dist/clad.js",              expect: "<inherits.bundle_sha.clad>"}   # comment-only ⇒ IDENTICAL
  - {cmd: "npx tsx tools/parity/compare.ts --tier=fast", expect: "IDENTICAL 0 expected-deltas"}
  - {cmd: "npm run conformance",                     expect: "exit 0"}
  - {cmd: "node bin/clad check --tier=pre-push --strict", expect: "GREEN"}
  - {cmd: "npx tsx tools/audit/census.ts --assert",  expect: "modules=420 absent=0 testrefs=243 absent=0"}

expected_deltas: []             # non-empty requires a written reason + a reviewer id,
                                # registered in ITS OWN prior commit. An agent may never
                                # add an entry to make its own unit pass.

exit:
  commit: <sha>
  lines: {src: -330, tests: 0, spec: +18, tools: 0}
  attestation_restamped: true
  carry:
    census: {entries: 276, modules: 420, modules_absent: 0, testrefs: 243, testrefs_absent: 0}
    test_count: {collected: 2815, executed: 2821}
    bundle_sha: {clad: <unchanged>, viewer: <unchanged>}
    allowlist_entries: 0
    stale_tests_headroom_days: 17.1     # decrements with wall time — watch the 30-day cliff
  residue:                              # what this unit deliberately did NOT do
    - "src/stages/detectors/spec-conformance.ts header is 14 lines: 2 over cap, both
       load-bearing (the DEFERRED-to-v2 spec-rev-hash adjudication). EXEMPTED —
       recorded in tools/audit/exemptions.yaml with this unit id."
```

**Running record.** `.refactor/units/*.yaml` (one per unit, committed with it) · `.refactor/baseline.json` (U-00, immutable) · `.refactor/ledger.md` (one appended line per unit: id, commit, Δlines, verdict, residue count) · `tools/parity/allow.yaml` (registered deltas) · `tools/audit/exemptions.yaml` (granted header exemptions, each with a unit id). `residue` is what distinguishes DONE from stopped (§9).

---

## 7. Failure protocol

The response is determined by **which invariant failed**, never by judgement. This is why §2 is ordered cheapest-and-most-diagnostic first: the failing index *is* the classifier.

| class | trigger | response | retry |
|---|---|---|---|
| **A — scope violation** | INV-2 fails (a path outside `touch_allowed`), or INV-1's tuple moved when `spec_cost` said it would not | **REVERT immediately.** The unit's declared scope was wrong; re-plan the unit — do not repair the diff | **no** |
| **B — own bug** | INV-6 fails on a test covering a file inside `touch_allowed` | **RETRY once in place.** An ordinary defect | **1** |
| **C — pin fired** | INV-3 red, or any repo-scanning tripwire red | **STOP. Do not touch the test.** Open a separate pin-renegotiation unit with a dated rationale, land it, then re-run this unit. **Editing a pin inside the unit that broke it is self-certification** — the exact thing this repo exists to prevent | **no** |
| **D — parity delta** | INV-12 reports a delta not in `allow.yaml` | **REVERT.** A new allow entry requires a written reason and a reviewer id, in its own commit, **before** the unit re-runs | **no** |
| **E — oracle blindness** | INV-13 fails at any phase boundary (a mutant returns IDENTICAL) | **REVERT EVERY UNIT SINCE THE LAST GREEN SELFTEST.** Everything verified by a blind oracle is unverified. Fix the normalization, then re-run the reverted units. This is why the selftest runs at every phase boundary, not once | **no** |
| **F — bundle moved on a comment unit** | INV-14 mismatch on a unit declared comment-only | **REVERT.** The unit changed code it believed it did not — the most valuable single signal in the program | **no** |
| **G — attestation only** | INV-10 red **solely** on `STALE_ATTESTATION` | **not a failure.** Re-stamp via the strict pre-push exemption and commit `spec/attestation.yaml` with the code. Note CI's final step is `--tier=pre-commit --strict`, which gets **no** exemption (`src/cli/clad.ts:643` gates EXEMPT/STAMP on `pre-push \|\| all`) — an un-restamped push is a red CI that reads like a regression | n/a |
| **H — test count** | INV-7 fails | **not a failure if the unit changed tests** — `npm run test-count -- --write`, six READMEs, same commit. If the unit changed no tests, it is class A | n/a |
| **I — stale tests** | INV-10 red on `STALE_TESTS` for files the unit never touched | **not a failure.** Working-copy mtime artefact (`STALE_DAYS = 30`, measured headroom ~19 days at U-00; a fresh CI checkout resets mtimes so it never breaks CI). Record it; **do not "fix" it by touching tests.** If the program exceeds the window, interleave a Phase-7 unit | n/a |
| **J — inadmissible** | a DONE entry cannot be written as a command | **the unit never starts.** Split it, build the instrument first, or drop it (U-59's GATE is the model: no stub-dispatcher lane ⇒ dropped, not downgraded to unit-test evidence) | n/a |

**Escalation.** Two consecutive reverts on one unit ⇒ the unit is mis-scoped: split per §5.1 and re-plan; do not attempt a third pass at the original scope. Three reverts within one phase ⇒ **halt the phase**, re-run the U-00 baseline measurement, re-derive the phase's units from the new baseline. Any class E ⇒ **halt the program**, not just the phase.

**Anti-rationalisation clause** — stated as a rule because an unattended agent will otherwise find the loophole. A unit may never reach GREEN by: (a) weakening a pinning test, (b) adding a parity allow entry, (c) lowering a coverage threshold, (d) narrowing `touch_allowed` after the fact, (e) writing the count or prose that a self-consistency test compares against instead of fixing the fact, or (f) deleting a mutant. Each of those is a green that certifies itself.

---

## 8. Interaction with the 0.10.0 behaviour-change program

**Rule zero: never a behaviour change and a refactor unit in the same commit.** A parity run with one intentional delta and one accidental one is unreadable — the accidental one hides inside the expected hunk. Every 0.10.0 unit registers its `allow.yaml` entry in its own commit, with a reason and a reviewer id, before the refactor resumes.

**Rule one: refactor Phases 0 and 1 come first, unconditionally.** Not one behaviour unit may land before the parity harness exists and its selftest is green. Without it, every 0.10.0 change is verified by "the tests passed" — and the tests do not reach the bundle (1 verb of 28), the MCP response bodies, the hook sidecar sequences, or the written artifact tree.

**Rule two: never a persona/prose edit in the same commit as code.** `tests/choreography-guard.test.ts` is 99 tests of prose assertions across 6 README variants, 6 persona sources, 3 built plugin mirrors and 4 locale SVGs, and its mirror assertions read `plugins/**`, which are **built** — so any persona edit requires `npm run build:plugin` in the same commit.

| 0.10.0 unit | must come after | why | which refactor unit makes it easier |
|---|---|---|---|
| **Stop hook → report-only** | U-13 (hook lane), U-55 | The blocking decision is the single most user-visible behaviour; it needs a captured before/after of the exact sequence, in both S and B lanes | U-55 turns the stop-block sidecar into one `sidecar<T>()`. **Hard constraint:** do not also unify the two `detector\|path` fingerprints in the same window (U-55's note) — if the report-only change and a fingerprint unification land together, every adopter's persisted `stop-block.json` silently stops matching and the failure is indistinguishable from the intended change |
| **Detector severity dial** | U-05, U-04, U-03 | U-05's `never warn` assertion is a **direct blocker**: if the dial can raise `ARCHITECTURE_VIOLATION` or `HARDCODED_SECRET` to `warn`, `src/stages/arch.ts` / `secret.ts`'s `filter(f => f.severity === 'error')` silently drops it and stage_1.5/1.6 pass while a strict drift run fails. Either exclude those two detectors from the dial or change the filter — the assertion forces the choice | U-52 gives one place to change the filter instead of two. U-04 protects emission order, which the dial's finding selection depends on |
| **Verification-capability disclosure** | **U-56, then U-63/U-64** | Adding disclosure fields to 22 hand-rolled response sites and *then* deduping them means the refactor chases a moving target. Measured: 49 `type: 'text'` envelopes vs 26 `mcpPayload` calls — ~23 responses today carry neither `structuredContent` nor `schema_version`, so **envelope normalization is itself the behaviour change** and belongs here, not in U-56 | U-56 makes it a one-place edit. U-12's MCP lane captures the whole response object on both branches, so the delta is explicit per tool |
| **`why` / `depends_on` mechanisms** | U-16 | `src/spec/schema.json` is claimed by 18 features and has `additionalProperties: false`, so any property change is adopter-visible and is its own feature with its own gate cycle | U-16's census makes the blast radius auditable before the edit |
| **Evidence producers** | **U-60** | A new writer into `.cladding/` must use the path accessors, or it adds to the 39 literals the refactor just removed | U-60 supplies `fsPath()`/`wirePath()` and the artifact lane already captures the whole `.cladding/` tree, so a new producer's output is diffed for free |
| **Instruction dedup** | U-75, and **alone** | Touches the AGENTS.md/CLAUDE.md generators and the personas — head-on collision with `choreography-guard` (99 tests), `claude-md-diet`'s byte-parity dogfood against this repo's own `CLAUDE.md`, and `shard-term-guard`. Requires `npm run build:plugin` in the same commit | U-70 removes the derived-ceiling coupling so the `1250` byte cap lives in one exported constant |
| **Persona alias removal** (moved here from all three arms) | U-12 | Removing `PERSONA_ALIASES` / `PERSONA_PROMPT_ALIASES` shrinks `listPrompts()` from 7 to 5 — a **wire-contract change**, so it violates the refactor's contract even though it is dead-code shaped. It is the ideal *first* 0.10.0 unit: small, obviously correct, and it exercises the `allow.yaml` machinery end to end | U-12 makes the delta a single registered hunk. Note `loader.ts:75` writes "removed in 0.8" to **stderr at runtime** and `server.ts:2023` embeds it in an MCP prompt description a host reads — so this also closes 3 of U-41's 6 version-promise findings |
| **`META_INTEGRITY` repair-card path fix** | U-41 | `meta-integrity.ts:34` reads `src/spec/schema.json` while two finding messages and `src/ui/softShell.ts:154` tell the user to restore `spec/schema.json`, which does not exist. The strings are **user-visible** and pinned by `plain-render` | U-41 fixes the comments so only the strings remain |
| **`token_budget_per_session` schema removal** | — | `additionalProperties: false` means removal breaks every adopter `spec.yaml` still carrying the field: a minor-version break, not a refactor. The refactor drops only cladding's own `spec.yaml:34` usage and the extraction paths, keeping `update.ts`'s deprecation report | — |
| **`ES_IMPORT_RE` + tier-derived forbidden imports** | U-67 | Both emit **new** findings on adopter repos (a barrel re-export → `error`; a tier-ordered `architecture.yaml` → `warn`, which `--strict` promotes). Shipping them inside a "break the cycle" unit would deliver a gate regression labelled as a refactor | U-67 does the type move; this does the detector change |
| **Polyglot language-table unification** | — | **Do not attempt as a dedup.** Two independent maps disagree today: `unmapped-artifact.ts:28-43` knows `rust/go/javascript`, while `language-config.ts:120-128` falls back to the TS config for everything but `typescript/kotlin/python`. Dedupe one way and every `UNMAPPED_ARTIFACT` error vanishes for Rust adopters (a vacuous green); dedupe the other and `CONVENTION_DRIFT` starts warning on `.rs` (a red gate on upgrade). Cladding's own suite is 100% TypeScript so **both directions are invisible here**. This is a behaviour feature needing a polyglot fixture matrix | — |

**Interleaving shape.** Phases 0–1 (refactor) → then alternate: one 0.10.0 unit, one refactor unit, never concurrently, never in one commit. The 1.5 MB committed bundle makes concurrency impossible anyway.

---

## 9. Definition of done

**Progress is measured by per-class worklist burn-down, never by line count.** Line reduction is an exit statistic. A program that targets lines deletes comments to reach the number, which is precisely the side effect the maintainer forbade.

| class | closure condition (a command with a literal result) | closed at |
|---|---|---|
| verification net | `tsc --listFiles \| grep -c '/src/'` = **185** · `eslint .` exit 0 with project rules matching **186** src files · `vitest run --coverage` exit 0 at the floor · `parity/selftest` **10/10** · bundle **S≡B** on the fast tier · clean-room fast tier green | Phase 1 |
| spec integrity | `census --assert` → `modules_absent=0 testrefs_absent=0` at every checkpoint | U-07 |
| manifest honesty | `allDetectors.length` == detector file count == `plugin.json` numerator, asserted by test | U-03 |
| invariant lift | the 5 records of §5 U-05 are executable assertions, each planted-defect probed | U-05 |
| reference integrity | `comments.ts --rule=refs --assert-clean` → `findings=0 visited>150` | U-40 |
| stale facts | `comments.ts --rule=facts --assert-clean` → `findings=0` | U-41 |
| header policy | `--rule=header-cap` → `offenders=0 visited=186`, every exemption carrying a unit id and a reason | U-44 |
| dead code | `audit/exports` "truly unreachable" bucket **empty** | U-31 |
| duplication | `audit/clones --min=12` → **0** cross-file runs above the declared threshold, or each survivor listed in `residue` with a reason | U-61 |
| boundaries | `madge --circular` **0** · `drive ↔ ui` cycle gone · **0** files moved · **0** pre-existing `modules[]` repaired | U-67 |
| tests | `vitest list --json` test-name list identical to U-71's entry snapshot except for units that declared a count change · all mutation probes still discriminate · T1/T2/T3/T5 clean over 272 files | U-75 |
| tooling | an explicit keep/delete decision recorded per tool | U-81 |

**Numbers this program commits to.**

| | before (measured) | after (projected) | Δ |
|---|---|---|---|
| src files | 186 | 197 (+13 new, −2 deleted) | +11 |
| src lines | **35,757** | ~32,400 | **−3,357 (−9.4%)** |
| src comment share | **28.5%** (10,227 lines) | ~24% (~7,800) | −2,400 |
| tests files | 272 | ~276 | +4 |
| tests lines | **52,745** | ~50,800 | **−1,945 (−3.7%)** |
| claimed module paths | **422** (0 absent) | ~433 (0 absent) | +11 |
| pre-existing spec entries **edited** | — | **2** (`F-041`, `F-063`, U-30 only) | — |
| `modules[]` paths **repaired** | — | **0** | — |
| `test_refs` **repaired** | — | **0** | — |
| new spec entries | 275 | ~324 | +49 |
| `tools/` lines (non-shipped) | 0 | ~3,300 | +3,300 |
| detectors / stages / tiers | 41 / 15 / 3 | **unchanged** | — |
| collected tests | **2,815** | 2,815 ± declared changes | — |

Composition of the src reduction: dead code −250 · verified in-file duplication −700 · move-enabled dedup −250 (net of ~+160 new-file overhead) · comment classes 1–3 −1,117 measured + ~−1,040 from R5/R8 body rules · new-file headers +160.

**The ceiling, stated honestly.** −3,357 (−9.4%) is what this program commits to. **Anyone promising more than −20% is promising comment deletion, not compaction:** measured exact cross-file duplication in `src` is **256 lines = 0.7%**, and total verified code-level duplication is ~900–1,200 lines. The gap between −9.4% and the ~−17% a full comment standardization would reach *is class 4*, and class 4 is cut.

**Gate runtime.** Baseline **249 suites / 2,821 tests / 115.8 s summed** (wall clock lower — vitest pools); the six slowest suites are 58 s for 87 tests. Expected effect: `tsc` +2–5 s (the program gains `tools/**` and 2 previously-unchecked src files), `eslint` +3–6 s (186 files gain the project rules for the first time), `stage_1.3` ≈0 (same 41 detectors, same predicates), `stage_2.1` +8–12 s (new tool suites; the scaffolding consolidation removes *lines*, not temp directories, so it saves no seconds). Parity is **outside** the gate: +45–90 s per unit (fast tier), 6–12 min per phase. **No speed claim is made.** Each unit's checkpoint asserts summed suite time within ±10% of 115.8 s and per-suite times within ±30% — a regression outside that band is a finding to investigate, and it is the only performance signal this repo can currently produce.

**DONE vs merely STOPPED.** DONE = every class at its closure condition **and** every unclosed item recorded in `residue` with a reason and a unit id. STOPPED = a class with a non-empty worklist and no admissible unit remaining. The distinguishing test is mechanical: run every audit tool; **any non-zero finding that is not in the residue register with a unit id is proof the program stopped.** A finding silently absent from both the worklist and the register is the exact failure mode this design exists to prevent.

---

## 10. Open questions for the maintainer

Genuine forks only — each changes what gets built, and preference decides.

**Q1 — Header cap: 12/24-exempt, or 18/none?** Measured: cap 12 with 9 contract modules at 24 removes **932 lines across 113 files** and needs an exemption register; a flat cap of 18 removes **411 across 62** and needs none. The 12/24 variant is what §5's numbers assume. The trade is 521 lines against one more piece of machinery and a judgement call per exemption.

**Q2 — Take Phase 6 (additive extraction) at all?** Without it the program is 8 units shorter, touches **zero** new src files, and ARM B's absolute guarantee holds — but `serve/server.ts` stays 2,030 lines, `cli/hook.ts` stays 1,209, `cli/clad.ts` stays 1,364, the 39 `.cladding` literals stay, and the `drive ↔ ui` cycle stays. With it: +13 files, +13 spec entries, ~+160 lines of new-file overhead, and the comprehension win. Phase 6 is the only part of the program whose value is not measurable by any oracle described here.

**Q3 — U-30 edits two `done` features' acceptance criteria.** It is the only unit that does. The alternative is leaving 51 dead src lines and 117 dead test lines in the tree permanently, and the program's "zero pre-existing entries edited" guarantee then becomes absolute. Delete, or keep as declared debt?

**Q4 — Persona aliases: 0.10.0 (as designed here) or folded into the refactor as an EXPECTED-DELTA?** All three arms wanted them in the refactor. This design moves them out because they change `listPrompts()` from 7 to 5, and "no side effects" should mean no side effects. Folding them back in is defensible and saves one hand-off.

**Q5 — Does parity live in CI after the program?** Keeping the fast tier as a CI step costs ~60–90 s per PR and gives cladding the observable-contract regression net it has never had. Deleting it saves that, and the next refactor rebuilds ~2,300 lines. `spec-remap`, `census` and the bundle lane are recommended keeps regardless.

**Q6 — Fix the Windows entry guard, or freeze it?** Verified: `import.meta.url === \`file://${process.argv[1]}\`` never matches on Windows, so all 13 `stage:*` scripts and `src/cli/benchmark.ts` are silent no-ops there today. U-50 extracts and table-tests the predicate **without changing behaviour**. Fixing it (`pathToFileURL(process.argv[1]).href`) makes 14 entry points start executing on Windows for the first time — a behaviour change with zero existing coverage on that platform, and one that would need a `windows-latest` CI leg to be worth anything. Fix in 0.10.0, or document and freeze?

**Q7 — Is the 2,815-vs-2,821 test-count delta known?** `README.md` pins 2,815 (from `vitest list`); `.cladding/test-report.junit.xml` reports 2,821 executed. U-00 characterizes it and forbids later units from investigating it. If the maintainer already knows the cause, U-00 shrinks; if not, it is worth one hour before the program starts, because six tests that `list` cannot see are six tests `test-count --check` cannot protect.
