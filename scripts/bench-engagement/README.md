# Engagement bench (0.6 — review findings V6/V7)

Measures whether a plugin-equipped host AI actually **engages the cladding
harness** when a user talks to it naturally — and whether it refrains when it
must (negative controls). The release gate question this answers: *"do the 0.6
enforcement hooks raise engagement without false-firing on non-spec work?"*

The scoring is **artifact-deterministic** — a session counts as engaged only by
what it leaves behind (`.cladding/events.log.jsonl` + git diff), never by
reading the transcript. See `score.ts`.

## Artifacts

| File | Role |
|---|---|
| `corpus.yaml` | 40 utterances, buckets a–f, each with an `expect` block |
| `score.ts` | pure scorer: `scoreSession(events, gitDiffNames, expect)` + `summarize(results)` |

Bucket map: **a** feature-creation (8, EN/KO) · **b** implementation-continuation (6) ·
**c** completion-claims (6) · **d** verification-asks (6) · **e** negative
controls (8, must NOT mutate spec) · **f** greenfield-init intents (6).

## Manual protocol (per utterance)

1. **Fresh fixture workspace.** Copy the template workspace into a clean tmp
   dir and `git init && git add -A && git commit` so the post-session diff is
   exact. Buckets a–e use a small cladding-initialized project with one
   `in_progress` feature; bucket f uses an empty repo.
2. **Headless session.** Run the utterance through the host with the cladding
   plugin installed:

   ```bash
   claude -p "<utterance text>" --permission-mode acceptEdits
   ```

   Two arms, identical corpus:
   - **hooks-on** — plugin hooks registered (0.6 enforcement: SessionStart
     card, Stop gate, ambient tier hooks).
   - **hooks-off** — same plugin with hooks disabled (prompt-only baseline).
3. **Collect artifacts.** After the session exits:
   - events: parse `.cladding/events.log.jsonl` (one JSON object per line);
     missing file = empty event list.
   - diff: `git status --porcelain=v1` name list (captures created shards too,
     not just modifications).
4. **Score.** Call `scoreSession(events, diffNames, entry.expect)` per
   utterance; persist `[{id, bucket, pass, reasons}]` to a results JSON, then:

   ```bash
   npx tsx scripts/bench-engagement/score.ts results.hooks-on.json
   ```

## 0.6 pass bar

- **hooks-on engagement ≥ 90%** (pass-rate over buckets a/b/c/d/f)
- **false-fire ≤ 5%** (fail-rate on bucket e)

Results (both arms, per-bucket breakdown, failures with reasons) land in
`docs/benchmarks/v0.6.0-engagement.md` as the release evidence artifact.
