# MCP11 reference-host cycle — Codex

Fixture: `~/mcp11-codex` (not part of this repository).
Feature: `F-032b6453` "Greeting module", one acceptance criterion `AC-e435a582`.
Host: `codex-cli 0.153.0`. Engine: cladding 0.10.0 from the RC working tree at commit
`0578818`, reached through the project launcher `.cladding/host/serve.cjs`.

## Honesty boundary

The maintainer instructed the session to run every step; the confirmation prompts of
`clad signoff --verified` were answered by an automation in a pseudo-terminal at the
maintainer's explicit instruction, not by a person at a keyboard. The host elicitation forms
of Claude Code and Codex were not exercised.

Concretely: Codex ran headless, and the receipts were produced by the `clad signoff` **CLI**
driven through an `expect(1)` pseudo-terminal, which typed the feature id at the prompt
`Type the feature id to sign a verified <claim> receipt:`. Codex itself signed nothing.

Codex was launched with `--approve-for-me` ("Route approval requests through automatic review
using the workspace-write sandbox"), never with `--dangerously-bypass-approvals-and-sandbox`.
The runbook's warning against a blanket auto-approval mode is about the host answering its own
signoff elicitation form; that path was not used here at all, because the signing was done
outside the host by the CLI.

## Headless invocation

Three separate `codex exec` runs, all with the same flags. The full command line of the first:

```
codex exec --approve-for-me -C /Users/qwerfunch/mcp11-codex \
  -c 'mcp_servers.cladding={command="node",args=[".cladding/host/serve.cjs"],disabled_tools=["clad_signoff","clad_ingest_receipt"]}' \
  --json -o .mcp11/codex-last-message.txt "$(cat .mcp11/prompt.txt)"
```

Notes on the invocation, recorded rather than fixed:

- the inline `mcp_servers.cladding` override is required because Codex loads a project
  `.codex/config.toml` only for a repository it trusts, and this fixture was never opened
  interactively to grant that trust
- `disabled_tools` was passed to keep the signing tools out of the host's reach. Its effect on
  the advertised tool catalog was **not** independently confirmed; the honest check is that
  `spec/evidence` did not exist after the implementation runs, and it did not
- `codex exec resume` rejects `--approve-for-me` (`error: unexpected argument`), so the two
  follow-up instructions were issued as fresh `codex exec` runs, not as a resumed thread
- stderr of the backgrounded runs carried `Reading additional input from stdin...`; it had no
  visible effect on the run

## Run 1 — implementation

Tool and command sequence extracted from `--json` events, in order:

1. shell — repository reconnaissance (`rg --files`, reading `AGENTS.md`, `spec.yaml`, config)
2. `clad_create_feature` — **failed** once (schema 0.2 requires a `statement` field on the
   criterion), then succeeded, creating `F-032b6453` / `AC-e435a582`
3. `clad_begin` — `F-032b6453`
4. `clad_get_feature` — `F-032b6453`
5. file change — added `src/greeting.ts`
6. shell — `git diff --stat && git status --short`
7. shell — `cat tests/greeting.test.ts && npm test` (the test file was written by a second
   Codex thread the primary one spawned and waited on)
8. `clad_run_gate` (pre-push, strict) — reported `failed`
9. shell — `node .cladding/host/serve.cjs sync` (the gate had reported `INVENTORY_DRIFT`)
10. `clad_run_gate` (pre-push, strict) — reported `failed` again

Codex then stopped **without committing**, correctly reasoning that the prompt made the commit
conditional on a green gate and the gate was not green: at L4 the gate cannot be green before a
human signs, so `stage_4.1` / `stage_4.2` stayed `unobserved` and achieved assurance was `L3`.
That is a defect in the fixture prompt (`.mcp11/prompt.txt`, mirroring runbook §5.0), not in
Codex's behaviour, and not in the engine.

## Run 2 — commit

A second `codex exec` corrected the instruction ("at L4 the gate cannot report green before a
human signs; 'until it is green' meant the automated stages only") and asked only for the
commit. Codex ran `git add -A && git commit -m "feat: greeting module"` — one shell call, no
edits — producing `50c35c6`. `spec/evidence` still did not exist.

## First signing attempt, discarded

The two receipts signed at `50c35c6`
(`5c1398ac6f15ad7c06099feed731b6cf97af6cf28439a35d511231adb8824eb0` audit,
`e3a0f914a1cde29234e978da3747f836564465c2d37ec763bb52116bba220bef` uat, commit `10283e8`)
were **discarded** in commit `e16d73d` and never used as evidence, because `clad done` then
refused:

```
✗ Drift
    A finished feature has an acceptance criterion with nothing proving it works [MISSING_TESTS]
        F-032b6453.AC-e435a582 declares no test_refs or evidence_refs — AC is unverified
```

Cause: Codex had written the coverage token at the **end** of the `it()` title. The engine's
carrier is anchored (`/^((?:\[covers:…\])+)/` in `src/proof/vitest-jest.ts`), so a token that
does not start the title binds nothing. The fixture prompt shows the token at the start in its
example but never states that the position is load-bearing.

Two product observations worth carrying forward, recorded here and not acted on in this round:

- the strict pre-push gate reported `stage_1.3` (Drift) as `pass` with an unbound criterion;
  `MISSING_TESTS` surfaced only at `clad done`, which evaluates the finished-feature rule
- the fixture prompt and runbook §5.0 should state the anchoring rule, not only show it

Because the fix changes the workspace, the earlier receipts could not stay: a receipt binds the
workspace it was signed against. They were dropped in a commit rather than by rewriting
history, so the record shows they existed.

## Run 3 — fix

A third `codex exec`, with the same flags, asked only for the token to be moved to the front of
the existing `it()` title. Codex changed exactly that one line, re-ran the gate, and committed
`1ae29bd` "test: anchor the covers token at the title start". `git diff 50c35c6..HEAD --stat`
over the source tree shows a single file, one insertion, one deletion.

Contract check after the fix: `npm run smoke`, `npm run perf` and `npm run visual` all pass,
`src/greeting.ts` exports `greet(name: string): string` returning `Hello, <name>!`.

Gate before signing: exit 1, state `unresolved`, achieved `L3`; every executed stage `pass`
with `stage_4.1` / `stage_4.2` `unobserved` — the expected L4 pre-signature shape.

## Signing

Two `clad signoff --verified --issuer qwerfunch` runs through the pseudo-terminal, audit first,
on a clean tree at `1ae29bd`:

| Claim | Subject | Digest | Verification |
|---|---|---|---|
| audit | `AC-e435a582` | `026211187c93449bd6a7e16de6de2982f5378f09efe843aaaa9bcdb061ba11e2` | `verified` / `current` |
| uat | feature | `507c59639825394dee9ca51f5ae911e8ee84ac227538181bee7fe5ef7baf47c7` | `verified` / `current` |

Issuer key id: `a237dda876e9159e8bc9106684206f6cde5639369b967c9b943b305d301ee5f3`.
Trust snapshot digest: `b6d1d70675d772aa109d52c52f594a8127490f5d6d0c5e8fcbb30c6f7b28e77d`.

The CLI's `--json` result carries `ok`, `code`, `message`, `evidence`, `path`, `digest`,
`issuerKeyId` and a `verification` block. It carries no `adapter` or `host` field — those
belong to the MCP tool result shape, and this cycle signed through the CLI.

Receipts commit: `45a4267` "chore: sign L4 receipts".

## Completion

`node .cladding/host/serve.cjs done F-032b6453` exited 0, reported the strict gate GREEN and
moved the feature `in_progress → done`, with `independence: self-certified`. The attestation
row carries `attestation_schema: 3`, `achieved_assurance_level: L4`, `tool_identity: 0.10.0`
and the trust snapshot digest above.

The re-run gate afterwards was GREEN: exit 0, state `green`, achieved `L4`, `stage_4.1` and
`stage_4.2` both `pass`.

Completion commit: `40107c2` "chore: complete F-032b6453". The fixture was left clean and
untouched after this point, so the receipts stay current.

## Files in this directory

- `evidence/` — both signed receipts, byte-for-byte copies of `spec/evidence/F-032b6453/`
- `issuers.yaml` — the fixture's committed trust registry
- `attestation.yaml` — the fixture's attestation file, carrying the v3 row for the feature
- `done.txt` — the full `clad done` output
- `gate-after-done.json` — the GREEN strict pre-push gate result
- `signoff-audit.json`, `signoff-uat.json` — the two signoff results as reported by the CLI
- `versions.txt` — host, node, engine and RC identity

No private key material was copied; `~/.cladding/keys/` is not evidence.
