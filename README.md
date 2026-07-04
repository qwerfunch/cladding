<p align="center">
  <img src="docs/img/social-preview.png" alt="cladding — Unified Governance for AI-Coupled Engineering" width="920">
</p>

<p align="center">
  <strong>English</strong> · <a href="README.ko.md">한국어</a>
</p>

<h1 align="center">cladding</h1>

<p align="center">
  <strong>To trust AI with coding, an organization needs three things —<br/>that the code can be trusted, that it's traced, and that it holds up as you scale. cladding builds those three.</strong><br/>
  True to its name (cladding = the outer layer), it wraps the host LLM and verifies what comes before and after.
</p>

<p align="center">
  <a href="https://github.com/qwerfunch/ironclad"><img src="https://img.shields.io/badge/ironclad-L4%20conformant-brightgreen" alt="ironclad"/></a>
  <a href="https://github.com/qwerfunch/ironclad"><img src="https://img.shields.io/badge/spec-v0.0.23-blue" alt="spec"/></a>
  <img src="https://img.shields.io/badge/tests-2035%2F2035-brightgreen" alt="tests"/>
  <img src="https://img.shields.io/badge/detectors-41-brightgreen" alt="detectors"/>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="license"/></a>
</p>

<p align="center">
  The official reference implementation of the <a href="https://github.com/qwerfunch/ironclad">Ironclad</a> standard.<br/>
  Before your host LLM (Claude Code · Codex · Gemini · Cursor) <em>starts</em> work, cladding feeds it the project's intent;<br/>
  after it <em>finishes</em>, cladding verifies the result with 41 detectors and a 15-stage gate.
</p>

<!-- ─────────────── Why an enterprise can trust AI with coding ─────────────── -->
- **Only verified code ships as "done"** — Even when the AI says "it's done," it has to clear the checks — so code that couldn't be verified is never recognized as complete.
- **Who · what · why is all on the record** — The evidence you need for audits, regulatory response, and handoff can be traced back at any time.
- **It holds up as the team grows and you add more AIs** — Because the spec is the shared baseline, conflicts and drift are blocked automatically.

<!-- ─────────────── Host-LLM partnership loop ─────────────── -->
<div align="center">

<img src="docs/img/en/relationship.svg" alt="Host LLM before (intent injection) · after (verification) · record (feedback loop) — how cladding wraps the LLM in a collaborative structure" width="920">

</div>

> **This loop is after one thing —** turning the AI's *"it's done"* from a **claim** into a **proof**.

So you can ship code an AI wrote with **the same trust as code a human wrote**.

cladding builds **itself** with cladding too — 214 of its 217 features cleared the same gate, the first L4 implementation of the Ironclad standard.

<!-- ─────────────── How it partners with the host LLM ─────────────── -->

## How it works with your host LLM

#### Before — inject the intent

*So the LLM starts with the right context.*

- **Project map injected** — every time a conversation starts, "how many features, what's in progress, the last verification result" is handed to the LLM automatically <sub>(now you can see it too ↓)</sub>.
- **Only the intent that matters** — just the *why* of the feature at hand, its related features, and its acceptance criteria are pulled out (it does not dump the whole spec).
- **Project rules applied** — the forbidden and preferred patterns the team agreed on go in as standing instructions every time.

**After — verify:** the 15-stage gate, 41 drift detectors, and an implementation-blind grader (below).

<sub>Real-time intervention (map injection · instant block · stop-block) all works on Claude Code. On Codex · Gemini · Cursor the same verification runs through in-conversation tool calls plus the git · CI gate.</sub>

<!-- ─────────────── done is earned ─────────────── -->

## "done" is earned, not declared

The chronic disease of AI coding is *"it's done"* declared with no verification behind it. In cladding, a feature's `status: done` is not a value you write — it's a value you **earn**.

<div align="center">

<img src="docs/img/en/intervention.svg" alt="One scene — a hook blocks the LLM's 'done' declaration, the gate's RED feeds back as a repair card, and 'done' is earned only when the gate is GREEN" width="920">

</div>

1. When the AI tries to **write the completion mark itself** → it's **blocked on the spot** ("earn completion by verifying it").
2. When the AI **requests** completion → all 9 deterministic stages run, and it's recorded as done **only if every one passes**; one failure and it auto-reverts — the E2E · evidence stages are handled by CI's full 15.
3. The moment it passes, a **verification signature** is left behind — committable proof that "this code was verified at this point."
4. Try to end a conversation leaving a failure → it **blocks you once** (end again on the same failure and it records the fact rather than letting it through) and carries the repair card into the next conversation.

The limits are disclosed plainly too: bypass paths exist that the instant block can't see, and those are caught by after-the-fact verification (the gate · drift checks). The instant block is the first line of defense, after-the-fact verification the second — and neither is a standalone guarantee.

<!-- ─────────────── What changes ─────────────── -->

## What changes

How a *vanilla AI coding environment* and a cladding environment behave in the same situation.

| Situation | Vanilla AI coding | cladding |
|---|:---|:---|
| **Code drifts from the spec** | fixed *if* a reviewer notices | auto-detected right after the edit (alert) · "done" can't pass while it's drifting |
| **The AI says "it's done"** | you can only take its word | `done` earned only when the gate is GREEN |
| **Ending a session in a failing state** | exits as-is, forgotten next time | the exit is blocked once, the repair card handed off |
| **Two devs add a feature at the same time** | merge conflict | hash-8 IDs · separate files → 0 conflicts |
| **Who verifies the AI-written code?** | the AI that wrote it self-certifies (risky) | an implementation-blind grader + the mechanical gate |
| **Switching AI tools** | reconfigure per tool | one spec → 4 hosts wired automatically |

<!-- ─────────────── Project map (knowledge graph) ─────────────── -->

## Project map — now you can see it and ask it <sub>new</sub>

cladding always keeps a **map** inside it that connects spec · code · tests · docs. Now you can see that map with your own eyes.

> **Why this matters — the docs and the code don't drift apart.**
> Docs lie as time passes — the code changes but the description stays put. cladding re-checks that connection every time the code is read, and blocks "done" while the two are out of sync.

Blue = spec (center), orange = code, green = tests, pink = docs; more-connected nodes grow larger and pull to the center.

<div align="center">

<img src="docs/img/en/graph.gif" alt="cladding knowledge graph — spec · code · tests · docs colour-coded and linked (animated)" width="920">

</div>

- **See — the whole project on one canvas** — Run `clad graph serve`, open the printed localhost address in your browser, and you see what connects to what at a glance.
- **Ask — "what breaks if I change this?"** — Ask the map and it tells you what's affected and which tests to run — it doesn't guess.
- **Measure — it shines brighter the larger the project** — The amount you have to look at when fixing something drops sharply — on average **4× less** than reading everything. (`clad measure`)

To launch it yourself — from your project folder:

```bash
clad graph serve                                  # live graph — localhost:3000, auto-reloads on save
clad graph export --format html --out graph.html  # or export to a single offline file (.html)
```

<sub>Both require cladding 0.7.0+.</sub>

<!-- ─────────────── How it works ─────────────── -->

## How it works

**Spec → Code → Tests** runs as a single cycle — the spec records the *why*, the gate verifies, and the detectors block drift.

<div align="center">

<img src="docs/img/en/cycle.svg" alt="Spec → Code → Tests cycle — the 15-stage verification and 41 drift detectors guard the cycle" width="700">

</div>

### 1. Spec — the single source of intent (SSoT)

The spec records the *why* (what we're building and why). A 4-tier single source of truth — *intent on top, the implementation below, code follows the spec*.

| Tier | Role | Defined & written by | Authority |
|---|---|---|---|
| **A — Spec** | intent (what · why) | humans define the intent → the LLM writes it in EARS form | sealed · doesn't change without human approval · outranks all |
| **B — Design** | design (how) | humans steer → the LLM writes | checked against A |
| **C — Derived** | implementation (code · tests) + **attestation** (verification signature) | the LLM writes | auto-regenerated by reading the code |
| **D — Audit** | audit record (what actually happened) | auto-recorded (append-only) | immutable |

**A outranks every tier below it** — if spec (A) and code (C) disagree, the *code* is the one that's wrong.

**Sharded · multi-dev safe** — like `spec/features/<slug>-<hash8>.yaml`, *each feature gets its own file* + an *8-char hash ID* (e.g. `F-d86375d8`). Two devs creating new features at the same time land in *different files with different IDs*, so zero merge conflicts. Details: [Hash-based feature IDs](docs/spec-ids-multi-dev.md).

<div align="center">

<img src="docs/img/en/ssot-tier.svg" alt="4-tier SSoT — A(Spec) → B(Design) → C(Derived + attestation) → D(Audit), A outranks B" width="640">

</div>

### 2. Gate — the 15-stage Iron Law

One check engine, bundled **by cost**: 3 at commit, 9 at push/completion, all 15 in CI. Only the depth differs.

<div align="center">

<img src="docs/img/en/iron-law.svg" alt="15-stage Iron Law gate — static(6) · test & conformance(4) · E2E(3) · evidence(2), attestation signature when GREEN" width="640">

</div>

| Stage | What it checks |
|---|---|
| **1.1 Type · 1.2 Lint** | type errors · code style |
| **1.3 Drift** | spec ↔ code mismatches across 41 detectors |
| **1.4 Commit · 1.5 Arch · 1.6 Secret** | clean working tree · architecture invariants · leaked API keys |
| **2.1 Unit · 2.2 Coverage** | unit tests pass · coverage drop blocked |
| **2.3 Spec conformance · 2.4 Deliverable smoke** | the implementation-blind grader's tests pass · the declared deliverable actually runs *(blocks the empty-green "tests pass but the deliverable doesn't run")* |
| **3.1 Smoke · 3.2 Perf · 3.3 Visual** | e2e critical paths · performance budgets · UI visual regression |
| **4.1 Audit · 4.2 UAT** | every AC (acceptance criterion) has at least one piece of evidence · every done feature has at least one piece of evidence |

### 3. Detector — 41 drift detectors

Drift in every direction across spec · code · test is detected automatically. Full catalog: [detector catalog](src/stages/detectors/README.md).

| Direction | What it catches | Count | Representative detectors |
|---|---|---|---|
| spec ↔ code | in the spec but missing from code, or code that strays from the spec | 10 | `MISSING_IMPLEMENTATION`, `AC_DRIFT`, `DELIVERABLE_INTEGRITY` |
| code ↔ test | code present but no tests · coverage drop · secrets | 6 | `MISSING_TESTS`, `COVERAGE_DROP`, `HARDCODED_SECRET` |
| spec ↔ test | an AC in the spec not verified by a test · false status | 6 | `UNTESTED_AC`, `STATUS_DRIFT`, `SPEC_CONFORMANCE` |
| spec hygiene | the spec's own integrity (ID collisions · dependency cycles) | 8 | `ID_COLLISION`, `SLUG_CONFLICT`, `DEPENDENCY_CYCLE` |
| environment integrity | build environment · meta files | 3 | `HARNESS_INTEGRITY`, `META_INTEGRITY` |
| verification freshness | whether code changed since the verification signature | 1 | `STALE_ATTESTATION` *(new)* |
| governance · docs | policy violations · doc drift · README claims beyond the evidence | 4 | `ABSENCE_OF_GOVERNANCE`, `PROJECT_CONTEXT_DRIFT`, `HOST_CLAIM_DRIFT` *(new)* |
| graph · doc links | broken doc ↔ spec links · missing dependency edges | 3 | `DOC_LINK_INTEGRITY`, `REFERENCE_INTEGRITY`, `INFERABLE_DEPENDS_ON` *(new)* |

The knowledge graph these power is a **traceability / retrieval** capability, not a correctness one — cladding's own A/B record shows correctness is orthogonal to governance. It tells you what connects to what and what to re-check; it does not claim the code is correct.

### 4. Cycle — one feature's lifecycle

Define → Sync → Implement → **Earn**. You earn "done" only by passing every check.

<div align="center">

<img src="docs/img/en/workflow.svg" alt="One feature's lifecycle — Define → Sync → Implement → Earn, completion earned when all checks pass / auto-revert on failure" width="760">

</div>

<!-- ─────────────── Multi-Agent ─────────────── -->

## Multi-Agent — separating the builder from the verifier

The agents that **build** are kept separate from the agents that **verify**, so no agent can sign off on its own work. **blind-author** goes one step further — the agent that writes the tests *has no tool to read the implementation at all* (no Read/Grep granted). "Wrote it without looking at the implementation" becomes a structural fact, not a promise. This separation aligns with the segregation-of-duties principle that regulatory · audit regimes (EU AI Act · SOX) call for — it maps onto the spirit of those regimes, not a certification.

<div align="center">

<img src="docs/img/en/multi-agent.svg" alt="Agent separation of duties — orchestrator dispatches, planner/developer/reviewer act, blind-author is the test writer who can't see the implementation, observability watches" width="700">

</div>

<!-- ─────────────── Ecosystem ─────────────── -->

## Ecosystem

cladding sits at the junction of three existing categories.

<div align="center">

<img src="docs/img/en/ecosystem.svg" alt="Ecosystem Venn — cladding at the junction of SDD · Runners · Multi-agent governance" width="640">

</div>

### How it differs from the neighbors

- **Spec Kit · OpenSpec · Tessl · Kiro** — tools that help you *write a good spec*. On top of that, cladding *keeps continuously cross-checking, inside the dev loop, that the spec and the actual code don't drift*.
- **BMAD · ChatDev · Claude Code Agent Teams** — systems for *splitting roles across multiple AI agents*. cladding's agent division of labor runs with *spec · gate · audit record* combined on top.
- **tdd-guard** — a tool that *forces the AI to write tests first*. The Unit · Coverage · oracle stages among cladding's 15 do the same job, more structurally.
- **OpenHands · Cline · Aider · Goose** — *runners that make the AI write code* (pure executors). cladding is the *upper layer that verifies and governs* the code those runners produce.

cladding's distinction is the *combination* — binding the core of the categories above into *one verification loop*.

<!-- ─────────────── Install ─────────────── -->

## Install

Two steps — install the infrastructure → create the project spec.

### Step 1 — Install the infrastructure (npm)

```bash
npm install -g cladding   # install the cladding CLI
cd <project>              # move into the project
clad setup                # auto-wire your AI tools (Claude / Codex / Gemini / Cursor)
```

<details>
<summary>Where <code>clad setup</code> connects (4 hosts · 5 wire points)</summary>

| Host (when detected) | Wired location | Auto-activation |
|---|---|---|
| Claude Code (`~/.claude/`) | `~/.claude/plugins/cladding` | `claude plugin marketplace add` + `install` |
| Codex CLI skills (`~/.agents/`) | `~/.agents/skills/cladding-*` | (auto on Codex restart) |
| Codex CLI MCP server (`~/.codex/`) | `[mcp_servers.cladding]` in `~/.codex/config.toml` | (TOML entry itself) |
| Gemini CLI (`~/.gemini/`) | `~/.gemini/extensions/cladding` | `gemini extensions link` |
| Cursor (`~/.cursor/`) | `mcpServers.cladding` in `~/.cursor/mcp.json` | (JSON entry itself) |

<!-- clad:host-claims {"claude":"verified","codex":"not-run","gemini":"not-run","cursor":"wiring-only"} -->
<!-- ^ machine-readable host-support claims. HOST_CLAIM_DRIFT compares these against the newest
     docs/dogfood/matrix.md evidence fence and warns under `clad check --strict` if a claim exceeds it.
     gemini/codex abstain ("not-run") until the matrix carries passing evidence for them — the 2026-07-03
     live run graded gemini `fail` (gemini-cli 0.42.0 crashes on every prompt in this environment).
     Refresh the evidence with `clad doctor --hosts` (with consent). -->

`clad setup` invokes each host's activation command automatically when the `claude` / `gemini` binaries are on PATH. Safe to re-run after an upgrade or after installing a new AI tool.

**Verification level (honesty note):** Claude Code is fully verified through real-usage campaigns (including real-time intervention). Codex · Gemini CLI have automated wiring + basic behavior confirmed. Cursor wires automatically, but real-usage verification is still pending — to be updated as it lands.

> **About the MCP server.** All 4 hosts wire cladding as an MCP server — only the wire *location* differs. MCP is not something you invoke directly — no `/mcp` slash, no manual connect step. The AI in each host calls cladding's tools on its own in response to *natural-language requests*; you only type `/cladding:init` once and chat normally.

</details>

### Step 2 — Init (create the project spec)

From the project directory, call it once inside your AI tool:

```
[inside your AI tool] /cladding:init "B2B payment SaaS"
```

The project's `spec.yaml` and supporting docs are created — once per project.

To raise enforcement: `clad init --with-hook` (install pre-commit + pre-push git hooks) · `clad init --with-ci` (scaffold the CI gate — true enforcement lives in CI).

### Three init scenarios

| Starting point | Command | What happens |
|---|---|---|
| **An idea, nothing else** | `/cladding:init "I'm going to build a B2B payment SaaS"` | LLM analyzes the domain → spec · docs · policies generated + 2–3 follow-up questions |
| **A planning doc** | `/cladding:init docs/plan.md` | recognizes the file path → loads the contents automatically and uses them as intent |
| **Adopting into an existing project** | `/cladding:init "apply cladding to this project"` | auto-scans the existing code → observed patterns merged with the intent |

### Init once, that's it

Init once and you're done — after that, just develop as usual. cladding runs the before/after loop in the background, so there are no commands to memorize.

### Upgrading

```
npm update -g cladding     # 1. install the new version
cd <your project>          # 2. once per project
clad update                # 3. bring it in line with the new version
```

Your code · `spec.yaml` · docs are left untouched, so it's safe — and if the newer version is stricter and has something to flag, it just **points it out** (it won't block or fix anything).

<!-- ─────────────── Status ─────────────── -->

## Status

| Version | Conformance | Tests | Gate | Features |
|---|---|---|---|---|
| v0.8.0 (2026-07) | L4 · [self-declared](https://github.com/qwerfunch/ironclad/blob/main/GOVERNANCE.md) | 2035 / 2035 | 15 stages · 41 detectors | 217 (214 done) |

<sub>195 test files · 6 capabilities · coverage drop blocked by the COVERAGE_DROP detector</sub>

> **Road to Ironclad 1.0** — 1.0 locks only when *two independent implementations pass the L4 conformance fixtures* ([GOVERNANCE § 1](https://github.com/qwerfunch/ironclad/blob/main/GOVERNANCE.md)). cladding is the first.


## Docs

- [Why cladding (project context)](docs/project-context.md)
- [4-tier governance model](docs/ssot-model.md)
- [Hash-based feature IDs](docs/spec-ids-multi-dev.md)
- [41 detector catalog](src/stages/detectors/README.md)
- [Glossary (EN · KO)](docs/glossary.md)
- [Governance · roadmap to 1.0](GOVERNANCE.md)


## License

MIT. [LICENSE](LICENSE) · Related: [Ironclad](https://github.com/qwerfunch/ironclad) (the standard cladding implements) · [harness-boot](https://github.com/qwerfunch/harness-boot) (the seed).
