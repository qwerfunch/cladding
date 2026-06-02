---
description: Author an IMPL-BLIND spec-conformance oracle for a feature's acceptance criterion, so the gate verifies the code matches the SPEC (not just the author's own tests). cladding calls no LLM — YOU spawn a blind sub-agent from a spec-only brief, then record it. Use when a feature opts into require_oracles, or to harden a done feature against latent non-conformance.
---

# Cladding oracle — impl-blind conformance authoring

A SPEC_CONFORMANCE oracle is a conformance test authored **without seeing the implementation**, so a passing
oracle means "matches the spec," not "matches the code." The A/B that motivated this: a blind oracle caught
bugs a code-peeking (sighted) oracle rubber-stamped (7/8 vs 4/8). cladding owns no LLM — the blinding is **your
discipline as the host**; cladding produces the brief, records provenance, and the gate audits it.

## Protocol (three steps — do them in order)

1. **Get the spec-only brief.** Run `clad oracle <featureId> --ac <acId>`. It prints the acceptance criterion
   + the module's declaration-only signatures — and NEVER an implementation body. This is the *only* thing the
   author may see.

2. **Spawn a FRESH, blind sub-agent** (the Task tool / a new sub-agent context) handed ONLY that brief. It MUST
   NOT read `src/` or any implementation file. Instruct it to write a vitest conformance suite that asserts
   **only what the criterion literally requires** — when the spec is silent on an edge, a WEAKER assertion, not
   a stronger guess (an over-strict oracle falsely fails correct code). The sub-agent's identity must differ
   from whoever implemented the feature.

3. **Record it.** Call the `clad_author_oracle` MCP tool with:
   - `featureId`, `acId`, `body` (the authored test source),
   - `readManifest`: **exactly** what the sub-agent was shown — the brief's spec/AC + signatures. It MUST NOT
     list an implementation file the feature owns (the gate fails on `manifest ∩ modules`).
   - `blind: true` only if the sub-agent's context was the brief and nothing else,
   - `authorName`: the sub-agent's identity (≠ the implementer).

   cladding writes `tests/oracle/<F>.<AC>.test.ts`, records `kind:'oracle'` provenance, and stamps
   `oracle_refs` onto the AC. The SPEC_CONFORMANCE gate (stage_2.3 + the detector) then RUNS the oracle against
   the real code and AUDITS author≠implementer + manifest∩modules=∅.

```
clad oracle F-1a2b3c --ac AC-004      # 1. print the blind brief
# 2. spawn a blind sub-agent with ONLY that brief → it writes the oracle
# 3. clad_author_oracle { featureId, acId, body, readManifest, blind:true, authorName }
```

## Honest boundaries (read these)

- **Blindness is enforced by YOU, not cladding.** cladding cannot see or restrict a sub-agent's file reads
  (sub-agent tool perms belong to the host). Hand the sub-agent ONLY the brief; do not let it open `src/`. The
  gate audits the manifest you report — it catches an honestly-reported impl read, not a lie. `blind:false`
  records an unattested (self-reported) manifest and the gate surfaces it as `info`.
- **First RED is ambiguous.** When a brand-new oracle fails on the current code, it is EITHER a real spec bug in
  the code (keep the oracle, fix the code) OR an over-strict oracle (the spec doesn't require it — revise/reject
  it). cladding cannot tell which without you. Decide deliberately; never auto-accept or auto-discard.
- **Opt-in.** The presence + provenance rules only bind under `spec.yaml::project.require_oracles: true`. Without
  it, an authored oracle still runs (stage_2.3) and its provenance is still recorded, but a missing oracle is not
  forced.
