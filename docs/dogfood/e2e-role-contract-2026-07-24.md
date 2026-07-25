# E2E clean-room — role-contract architecture (packed 0.9.1 + branch), 2026-07-24

External-environment verification of the role-contract features on
`feature/role-contract-architecture` (independence label `032f5fd`, orchestrator
contract card `b824609`, persona role briefs `3ec187a`), run against the **packed
artifact** (`npm pack` → `cladding-0.9.1.tgz`, version unbumped on purpose), not
the repo source. Precedent: `e2e-0.9.0-packed-2026-07-16.md`.

**Isolation**: tarball installed into a throwaway npm prefix; sandbox `HOME`;
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` unset; sandbox project =
small TypeScript package with real local devDeps (tsc/vitest/eslint/madge/
secretlint — the gate's `npx --offline --no-install` resolves locally only), its
own git history. The repo working tree was never touched by the campaign.
Execution: Sonnet verifier agents; judgment: Fable. Raw per-scenario transcripts
lived in the session scratchpad; this file is the durable record.

## Verdict

| # | Scenario | Result |
|---|---|---|
| S0 | Tarball self-inspection + isolated install | PASS |
| S1 | Fresh `clad init --no-llm` → first feature → `clad done`, default policy | PASS |
| S2 | Blind oracle via MCP `clad_author_oracle` earns `independent` | PASS |
| S3 | `independence_policy: require` — refusal / recovery / CLI-only lock-in | PASS (a·b·c) |
| S4 | Contract card + role briefs delivered via MCP prompts AND plugin agents dir | PASS |
| S5 | Fresh context runs a full feature cycle from the contract card alone | PASS |

**Implementation defects: 0.** Design gaps confirmed: 2 major + 2 minor (below).

## Scenario evidence (condensed)

**S0** — packed `dist/clad.js` carries `computeIndependence`/`self-certified`/
`independence_policy`; `dist/schema.json` has the field; `dist/agents/orchestrator.md`
and `plugins/claude-code/agents/orchestrator.md` carry "the host owns execution";
all five role briefs carry the literal "role brief". `clad --version` → 0.9.1.

**S1** — init scaffold correct; `.cladding/audit.log.jsonl` absent until first
evidence (lazy, as designed). First `clad done` REd on a real `CONVENTION_DRIFT`
(missing file-header comment) — fixed like a user would, then:
`✓ done · F-6c7b254c strict gate GREEN` + `ℹ independence: self-certified — no
independent or human review yet`. `clad verdict` human line: `verdict: DONE —
independence: 0 independent / 1 self-certified`; `--json` carries
`independence: [{id, label}]`. Double-poll wrote no tracked file (poll-not-mutate).

**S2** — raw newline-delimited JSON-RPC stdio client against `clad serve`;
`clad_author_oracle` with `blind: true` created the audit log's first entry
(`"blind":true`), auto-stamped `oracle_refs` on the AC, and the next
`clad done` printed `independence: independent — backed by human or independent
review`.

**S3** — hand-set `independence_policy: require` accepted by the bundled schema.
(a) Self-certified `clad done` refused, exit 1, spec-entry checksum byte-identical
before/after, refusal message in plain language ("the checks passed, but this
feature has no independent or human review yet — this project asks for one before
completion. … Add a human sign-off or an independent (blind) review, then re-run
`clad done`."). (b) Blind-oracling the same feature over MCP → done GREEN +
`independent`. (c) Lock-in probe: all 26 CLI verbs enumerated, structurally
capable ones live-probed with audit-log checksums around each — **no CLI-only
path writes independence-eligible evidence** (`clad oracle` prints, never
records; checkpoint/rollback write the events ledger, not the audit ledger;
`clad run` adapters hard-code `author:'llm'`).

**S4** — `prompts/get orchestrator` (MCP) and the installed plugin file both
contain "the host owns execution" / `independent` / `self-certified`, and both
lack "routing table" / "invocation principles" / "dispatch … concurrently";
`developer` carries "role brief" in both channels. The shipped artifact delivers
the contract, not just the repo source.

**S5** — a fresh agent given ONLY the four shipped role briefs (repo access
blocked) handled two requests: (1) a request colliding with an existing done
feature → it refused to duplicate, re-verified via the real gates ("never an
agent's say-so"), correct behavior with no anti-duplication rule spelled out;
(2) a genuinely new feature (`lerp`) → full forward cycle unassisted: hash spec
entry with a recorded design decision, style-conformant impl, a **structurally
blind test author** (separate agent, `clad oracle` brief only, no impl access),
a separate read-only reviewer, `INVENTORY_DRIFT` healed with `clad sync`,
`clad done` GREEN (`status: planned → done`), committed. The choreography layer
removed in F2/F3 was not missed — the contract card alone was sufficient.

## Design gaps (recorded, deliberately not fixed in this branch)

1. **G1 — `independent` is MCP-gated.** The only first-party writer of
   independence-eligible evidence is the `clad_author_oracle` MCP tool. A
   CLI-only user can never earn `independent`, and under
   `independence_policy: require` is hard-blocked with no first-party exit
   (S3-c, empirical). S5 sharpened the sting: an agent that *actually performed*
   the blind separation still reads `self-certified` because it could not record
   the provenance. Follow-up candidate: a CLI surface to record independent/
   human evidence (e.g. `clad attest`), or documenting the MCP requirement in
   the refusal message.
2. **G2 — `human` evidence has zero first-party writers anywhere.** Even the MCP
   route hard-codes `identity.author: 'llm'` (`recordOracle`); the `human` half
   of the label's disjunction — and stage_4's `checkAc` demand, which predates
   this branch — is satisfiable only by hand-editing `.cladding/audit.log.jsonl`.
   Pre-existing, surfaced by the label.
3. **G3 (minor) — planner.md tells external users to run `npm run spec:validate`
   / `npm run stage:drift`**, scripts that exist only in cladding's own repo.
   Dogfood leakage in a shipped role brief; the S5 agent substituted the real
   CLI equivalents on its own.
4. **G4 (minor) — `clad status` Aud/UAT columns confused the S5 agent**
   (blind-oracled features showed `✗ ✗` while self-certified ones showed `✓ ✓`);
   semantics undocumented in the role briefs. Pre-existing surface, observation
   only.

## Friction log (working as designed, kept for the record)

| Where | Symptom | Resolution |
|---|---|---|
| S1 first done | `CONVENTION_DRIFT` missing file header | user-style fix, then GREEN |
| S2/S3/S5 done after writes | `STALE_ATTESTATION` finding | self-healed in the same run |
| S5 gate | `INVENTORY_DRIFT` after hand-authored spec entry | `clad sync`, then GREEN |
