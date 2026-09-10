#!/usr/bin/env bash
# Cladding · scripts/ab-abc/run-cell.sh — run one cell's live agent, then collect.
#
# Safety rules this script enforces mechanically, because a past campaign lost a
# night to a driver that resurrected itself and ran cells concurrently:
#
#   * one at a time — a lock file in ABC_ROOT; a second run refuses to start;
#   * budget first — the cumulative ledger is checked BEFORE the host is spawned
#     and updated immediately after, so a crash can only under-count spending by
#     the run that crashed;
#   * no watch loop — this script runs exactly one cell and exits. Sequencing is
#     the operator's job, deliberately.
#
# Usage: ABC_ROOT=~/abc-0100 bash scripts/ab-abc/run-cell.sh <A|B|C> <cell-name>
set -euo pipefail

ARM="${1:?usage: run-cell.sh <A|B|C> <cell-name>}"
CELL="${2:?usage: run-cell.sh <A|B|C> <cell-name>}"

ABC_ROOT="${ABC_ROOT:-$HOME/abc-0100}"
ABC_HARNESS="${ABC_HARNESS:-/Users/qwerfunch/Developer/work/cladding/scripts/ab-abc}"
ABC_REPO="${ABC_REPO:-/Users/qwerfunch/Developer/work/cladding}"
ABC_MODEL="${ABC_MODEL:-claude-opus-5}"
ABC_CELL_BUDGET="${ABC_CELL_BUDGET:-6}"

WORKSPACE="$ABC_ROOT/cells/$ARM/$CELL"
ARTIFACTS="$ABC_ROOT/artifacts/$ARM/$CELL"
PREFIX="$ABC_ROOT/prefix-$ARM"
LOCK="$ABC_ROOT/.lock"
LEDGER="$ABC_ROOT/budget.json"

[ -d "$WORKSPACE" ] || { echo "no such cell: $WORKSPACE (run make-cell.sh first)" >&2; exit 1; }
[ -f "$ARTIFACTS/cell.json" ] || { echo "no cell.json in $ARTIFACTS" >&2; exit 1; }
[ -f "$LEDGER" ] || { echo "no budget ledger at $LEDGER (run freeze.sh first)" >&2; exit 1; }

if [ -e "$LOCK" ]; then
  echo "another cell is running (lock: $LOCK, held by $(cat "$LOCK")) — campaign cells run one at a time" >&2
  exit 1
fi
printf '%s %s/%s %s\n' "$$" "$ARM" "$CELL" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

log() { printf '%s\n' "$*" | tee -a "$ARTIFACTS/env.log"; }

# ── budget gate (before any spending) ─────────────────────────────────────────
node "$ABC_HARNESS/budget.mjs" check "$LEDGER" "$ABC_CELL_BUDGET" | tee -a "$ARTIFACTS/env.log"

log "## run $ARM/$CELL — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── PATH: the arm's engine, or arm A's failing stub ───────────────────────────
if [ "$ARM" = "A" ]; then
  export PATH="$ARTIFACTS/stub-bin:$PATH"
else
  export PATH="$PREFIX/bin:$PATH"
fi
log "clad on PATH: $(command -v clad || echo '<none>')"
if [ "$ARM" = "A" ]; then
  # Probing the version here would call the stub and make the cell look
  # contaminated before the agent has done anything. The log is truncated just
  # before the session so every line in it belongs to the agent.
  : > "$ARTIFACTS/stub-calls.log"
else
  log "clad --version: $(clad --version 2>&1 || true)"
fi

MCP_FLAGS=(--strict-mcp-config)
if [ "$ARM" != "A" ]; then
  MCP_FLAGS+=(--mcp-config .mcp.json)
fi

# The prompt is read from the cell's own artifacts, never from the harness: a
# cell built with a different brief (the completion-claim trap) must run with the
# brief it was built for, and the bytes actually sent are the bytes on record.
PROMPT_FILE="$ARTIFACTS/prompt.txt"
[ -f "$PROMPT_FILE" ] || { echo "cell has no recorded prompt at $PROMPT_FILE" >&2; exit 1; }
PROMPT="$(cat "$PROMPT_FILE")"
log "prompt: $PROMPT_FILE ($(wc -c <"$PROMPT_FILE" | tr -d ' ') bytes)"
cd "$WORKSPACE"

node -e 'const fs=require("node:fs");const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,"utf8"));m.startedAt=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n");' "$ARTIFACTS/cell.json"

# The nested-session variables would make the host behave as a subagent of this
# very session; unset so every cell starts from the same clean host state.
#
# Permissions are the same for all three arms and deliberately wide: an ordinary
# shell is allowed, because a cell denied `mkdir` would be measuring the
# allow-list rather than the engine. The fixture is a throwaway directory outside
# the repository, which is what makes that safe. What is NOT allowed, in any arm,
# is bypassing the permission system itself.
START_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
set +e
env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SAFE_MODE -u CLAUDE_CODE_SIMPLE \
  claude -p "$PROMPT" \
    --model "$ABC_MODEL" \
    --output-format stream-json \
    --verbose \
    --setting-sources project \
    --settings '{"effortLevel":"medium"}' \
    --no-session-persistence \
    --max-budget-usd "$ABC_CELL_BUDGET" \
    --permission-mode acceptEdits \
    "${MCP_FLAGS[@]}" \
    --allowedTools "Read,Edit,Write,MultiEdit,Glob,Grep,LS,Bash,mcp__cladding" \
    > "$ARTIFACTS/run.jsonl" 2> "$ARTIFACTS/run.stderr"
HOST_EXIT=$?
set -e
END_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
echo "$HOST_EXIT" > "$ARTIFACTS/run.exit"
echo $((END_MS - START_MS)) > "$ARTIFACTS/wall-ms.txt"
log "host exit: $HOST_EXIT, wall $(cat "$ARTIFACTS/wall-ms.txt") ms"

# ── budget ledger (immediately, before any slower collection step) ────────────
node "$ABC_HARNESS/budget.mjs" record "$LEDGER" "$ARTIFACTS/run.jsonl" "$ARM" "$CELL" | tee -a "$ARTIFACTS/env.log"

# ── workspace state ───────────────────────────────────────────────────────────
git status --porcelain=v1 > "$ARTIFACTS/git-status.txt" || true
git diff > "$ARTIFACTS/git-diff.txt" || true
git log --oneline > "$ARTIFACTS/git-log.txt" || true
BASELINE="$(node -e 'process.stdout.write(require(process.argv[1]).baselineCommit)' "$ARTIFACTS/cell.json")"
git log --format='%H%x09%s' "$BASELINE..HEAD" > "$ARTIFACTS/agent-commits.txt" || true
log "commits the agent made: $(wc -l < "$ARTIFACTS/agent-commits.txt" | tr -d ' ')"
if [ -f "$WORKSPACE/.cladding/events.log.jsonl" ]; then
  cp "$WORKSPACE/.cladding/events.log.jsonl" "$ARTIFACTS/events.log.jsonl"
fi

# ── the judge ─────────────────────────────────────────────────────────────────
# B and C are judged by their own engine's strict pre-push gate, and it runs
# FIRST — before the measurement pass rewrites the test report, creates a
# coverage directory and churns file times. The judge must see the tree the
# agent left, not the tree the measuring left.
if [ "$ARM" != "A" ]; then
  set +e
  clad check --tier=pre-push --strict --json > "$ARTIFACTS/judge-gate.json" 2> "$ARTIFACTS/judge-gate.err"
  echo $? > "$ARTIFACTS/judge-gate.exit"
  set -e
  log "arm $ARM judge: strict pre-push exit $(cat "$ARTIFACTS/judge-gate.exit")"
fi

# ── the measurement pass ──────────────────────────────────────────────────────
# Everything below runs in the arm's OWN fixture after the judge has spoken.
# None of it involves a model and none of it reads the transcript: every number
# is a tool's exit code or a file that tool wrote. Arm A has no engine, so these
# results are its whole judgement.
set +e
npx tsc --noEmit > "$ARTIFACTS/typecheck.log" 2>&1
echo $? > "$ARTIFACTS/typecheck.exit"
npx eslint . -f json > "$ARTIFACTS/eslint.json" 2> "$ARTIFACTS/eslint.err"
echo $? > "$ARTIFACTS/eslint.exit"
npx vitest run --reporter=junit --outputFile="$ARTIFACTS/junit.xml" > "$ARTIFACTS/unit.log" 2>&1
echo $? > "$ARTIFACTS/npm-test.exit"
npx vitest run --coverage --coverage.include='src/**' > "$ARTIFACTS/coverage.log" 2>&1
echo $? > "$ARTIFACTS/coverage.exit"
set -e
if [ -f "$WORKSPACE/coverage/coverage-summary.json" ]; then
  cp "$WORKSPACE/coverage/coverage-summary.json" "$ARTIFACTS/coverage-summary.json"
fi
log "measure: tsc $(cat "$ARTIFACTS/typecheck.exit"), unit $(cat "$ARTIFACTS/npm-test.exit"), coverage $(cat "$ARTIFACTS/coverage.exit")"

# The hidden oracle: copied in, run once, removed again. It is never present
# while an agent is working, so no arm can be written against it.
ORACLE_DEST="$WORKSPACE/tests/__abc_oracle.test.ts"
cp "$ABC_HARNESS/oracle/slugify.oracle.test.ts" "$ORACLE_DEST"
set +e
npx vitest run --reporter=json --outputFile="$ARTIFACTS/oracle.json" "tests/__abc_oracle.test.ts" > "$ARTIFACTS/oracle.log" 2>&1
echo $? > "$ARTIFACTS/oracle.exit"
set -e
rm -f "$ORACLE_DEST"
log "measure: oracle exit $(cat "$ARTIFACTS/oracle.exit") — reported only, never a release verdict"

# The workspace must end the way the agent left it — the oracle is gone, and the
# coverage run writes only ignored directories.
git status --porcelain=v1 > "$ARTIFACTS/git-status-after-measure.txt" || true

# ── score ─────────────────────────────────────────────────────────────────────
# Scoring lives in rescore.sh so a finished cell can be re-scored without a
# host: it scores twice, compares, records the verdict, and scores once more so
# score.json actually carries it. Writing anything into $ARTIFACTS from here
# would land between its two comparison runs and read as a scorer difference —
# so the log line waits until it has returned.
ABC_ROOT="$ABC_ROOT" ABC_HARNESS="$ABC_HARNESS" ABC_REPO="$ABC_REPO" \
  bash "$ABC_HARNESS/rescore.sh" "$ARM" "$CELL" > /dev/null
REPRODUCIBLE="$(cat "$ARTIFACTS/scorer-reproducible.txt")"
[ "$REPRODUCIBLE" = "true" ] || log "WARNING: scoring the same cell twice produced different output"
log "score.json written (scorer reproducible: $REPRODUCIBLE)"
# Field names follow score.ts's CellScore exactly: turns live under `time`, cost
# under `tokens`. The earlier `s.cost.numTurns` was a TypeError that killed the
# summary line after a cell had already run.
node -e 'const s=require(process.argv[1]);console.log(s.arm+"/"+s.cell+": engaged="+s.outcome.engaged+" honest_done="+s.outcome.completedHonest+" binding="+s.outcome.bindingMode+" judge="+s.outcome.judgeExit+" turns="+s.time.numTurns+" cost_usd="+s.tokens.totalCostUsd);if(s.disqualifiers.length>0)console.log("  disqualifiers recorded: "+s.disqualifiers.join("; "));' "$ARTIFACTS/score.json"
