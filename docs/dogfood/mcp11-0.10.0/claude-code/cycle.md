# MCP11 reference-host cycle — Claude Code

Fixture: `~/mcp11-claude-code` (not part of this repository).
Feature: `F-3222d1cf` "Greeting module", one acceptance criterion `AC-24475f69`.
Engine: cladding 0.10.0 from the RC working tree at commit `0578818`, reached through the
project launcher `.cladding/host/serve.cjs`.

## Honesty boundary

The maintainer instructed the session to run every step; the confirmation prompts of
`clad signoff --verified` were answered by an automation in a pseudo-terminal at the
maintainer's explicit instruction, not by a person at a keyboard. The host elicitation forms
of Claude Code and Codex were not exercised.

Concretely: the receipts below were produced by the `clad signoff` **CLI** driven through an
`expect(1)` pseudo-terminal, which typed the feature id at the prompt
`Type the feature id to sign a verified <claim> receipt:`. The signature, the issuer key and
the offline verification are genuine; the human confirmation channel was satisfied by
automation acting on the maintainer's instruction. Nothing in this record should be read as
evidence that a person re-typed the feature id, or that either host's own signoff elicitation
form was tested.

## Implementation

The implementation half of this cycle was carried out in an earlier session by headless
Claude Code 2.1.263 through the Cladding MCP server. This round did not re-run it. The
fixture's own event log (`.cladding/events.log.jsonl`) records the sequence it left behind:

1. `gate_run` (pre-push, strict) — scaffold baseline
2. `feature_created` — `F-3222d1cf`, slug `greeting` (`clad_create_feature`)
3. `feature_checkpoint` — cycle start (`clad_begin`)
4. `gate_run` blocked on `INVENTORY_DRIFT`, then a clean re-run
5. `working_set_served` — `clad_get_context` for `F-3222d1cf`
6. `gate_run` (pre-push, strict) at the implementation commit

Implementation commit: `c6bbbdb` "feat: greeting module". `spec/evidence` did not exist at
that point: the implementing host signed nothing.

Gate before signing (`clad check --tier=pre-push --strict`): exit 1, assurance state
`unresolved`, achieved `L3`; every executed stage `pass`, with `stage_4.1` and `stage_4.2`
`unobserved`. That is the expected L4 shape before a human receipt exists.

## Signing

Two `clad signoff --verified --issuer qwerfunch` runs through the pseudo-terminal, audit first:

| Claim | Subject | Digest | Verification |
|---|---|---|---|
| audit | `AC-24475f69` | `b0f8de83282b7c0972baeb21603d6183891d280a5aaadcdf6ae38daf5eb689a2` | `verified` / `current` |
| uat | feature | `656c3cd3c35690b9d0e66c15e5ad5b738a25fb2e45a1543fb7d075580dec5238` | `verified` / `current` |

Issuer key id: `b3b3febf84aed336596ab5014a5349fb96165a5516f26bc507a568a521bba7bb`.
Trust snapshot digest: `21ab47df3de5fce8b83965b9dad18b249fcecab6fe6a2426bc670beadf23b622`.
Both receipts landed under `spec/evidence/F-3222d1cf/` and nothing else in the tree changed.

The CLI's `--json` result carries `ok`, `code`, `message`, `evidence`, `path`, `digest`,
`issuerKeyId` and a `verification` block. It carries no `adapter` or `host` field — those
belong to the MCP tool result shape, and this cycle signed through the CLI.

Receipts commit: `aa1f74f` "chore: sign L4 receipts".

## Completion

`node .cladding/host/serve.cjs done F-3222d1cf` exited 0, reported the strict gate GREEN and
moved the feature `in_progress → done`, with `independence: self-certified`. The attestation
row for the feature carries `attestation_schema: 3`, `achieved_assurance_level: L4`,
`tool_identity: 0.10.0` and `trust_snapshot_sha256`
`21ab47df3de5fce8b83965b9dad18b249fcecab6fe6a2426bc670beadf23b622`.

The re-run gate afterwards was GREEN: exit 0, state `green`, achieved `L4`,
`stage_4.1` and `stage_4.2` both `pass`.

Completion commit: `7fbaf6d` "chore: complete F-3222d1cf". The fixture was left clean and
untouched after this point, so the receipts stay current.

## Files in this directory

- `evidence/` — both signed receipts, byte-for-byte copies of `spec/evidence/F-3222d1cf/`
- `issuers.yaml` — the fixture's committed trust registry
- `attestation.yaml` — the fixture's attestation file, carrying the v3 row for the feature
- `done.txt` — the full `clad done` output
- `gate-after-done.json` — the GREEN strict pre-push gate result
- `signoff-audit.json`, `signoff-uat.json` — the two signoff results as reported by the CLI
- `versions.txt` — host, node, engine and RC identity

No private key material was copied; `~/.cladding/keys/` is not evidence.
